import {
	request as httpRequest,
	type IncomingMessage,
	type Server,
} from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GuiRunner } from "../../src/gui/runner.js";
import { createGuiServer, type GuiServerDeps } from "../../src/gui/server.js";
import { defaultGuiState, type GuiState } from "../../src/gui/state.js";
import { ok } from "../../src/shared/types.js";

const TOKEN = "test-token";
const CONFIG_PATH = "D:\\work\\render-config.json";

const servers: Server[] = [];

async function start(
	deps: Partial<GuiServerDeps> = {},
): Promise<{ base: string; runner: GuiRunner }> {
	const gui = createGuiServer({
		configPath: CONFIG_PATH,
		token: TOKEN,
		loadState: async () => defaultGuiState,
		saveState: async () => ok("state.json"),
		...deps,
	});
	servers.push(gui.server);
	await new Promise<void>((resolve) => {
		gui.server.listen(0, "127.0.0.1", resolve);
	});
	const { port } = gui.server.address() as AddressInfo;
	return { base: `http://127.0.0.1:${port}`, runner: gui.runner };
}

/**
 * `fetch` は `Host` を上書きできず、ストリーミング応答の読み出しも
 * 待ち続けてしまうため、この 2 つだけ生の http クライアントで検証する。
 */
function rawGet(
	base: string,
	requestPath: string,
	headers: Record<string, string>,
): Promise<IncomingMessage> {
	const url = new URL(requestPath, base);
	return new Promise((resolve, reject) => {
		const clientRequest = httpRequest(
			{
				hostname: url.hostname,
				port: url.port,
				path: `${url.pathname}${url.search}`,
				method: "GET",
				headers,
			},
			resolve,
		);
		clientRequest.on("error", reject);
		clientRequest.end();
	});
}

function authorized(body?: unknown, method = "POST"): RequestInit {
	return {
		method,
		headers: { "x-gui-token": TOKEN, "content-type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	};
}

afterEach(async () => {
	await Promise.all(
		servers.splice(0).map(
			(server) =>
				new Promise<void>((resolve) => {
					server.closeAllConnections();
					server.close(() => resolve());
				}),
		),
	);
});

describe("GUI server access control", () => {
	it("rejects a request without the token", async () => {
		const { base } = await start();

		const response = await fetch(`${base}/api/state`);

		expect(response.status).toBe(401);
	});

	it("rejects a token that does not match", async () => {
		const { base } = await start();

		const response = await fetch(`${base}/api/state?t=wrong`);

		expect(response.status).toBe(401);
	});

	it("rejects a request whose Host is not loopback", async () => {
		const { base } = await start();

		const message = await rawGet(base, "/api/state", {
			"x-gui-token": TOKEN,
			host: "evil.example.com",
		});
		message.resume();

		expect(message.statusCode).toBe(403);
	});

	it("serves the page with the token embedded", async () => {
		const { base } = await start();

		const response = await fetch(`${base}/?t=${TOKEN}`);
		const html = await response.text();

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/html");
		expect(html).toContain(JSON.stringify(TOKEN));
		expect(html).toContain("書き出す Scene");
	});

	it("returns 404 for an unknown path", async () => {
		const { base } = await start();

		const response = await fetch(`${base}/nope?t=${TOKEN}`);

		expect(response.status).toBe(404);
	});
});

describe("GUI server state", () => {
	it("returns the persisted state", async () => {
		const stored: GuiState = {
			...defaultGuiState,
			projectPath: "D:\\proj",
			selectedScenes: ["Main"],
		};
		const { base } = await start({ loadState: async () => stored });

		const response = await fetch(`${base}/api/state?t=${TOKEN}`);

		expect(await response.json()).toEqual({ state: stored });
	});

	it("sanitizes the posted state before saving it", async () => {
		const saveState = vi.fn(async (_state: GuiState) => ok("state.json"));
		const { base } = await start({ saveState });

		const response = await fetch(
			`${base}/api/state`,
			authorized(
				{ projectPath: "D:\\proj", selectedScenes: ["A", "A", 7], formats: [] },
				"PUT",
			),
		);

		expect(response.status).toBe(200);
		expect(saveState.mock.calls[0]?.[0].selectedScenes).toEqual(["A"]);
		expect(saveState.mock.calls[0]?.[0].formats).toEqual(["mp4"]);
	});
});

describe("GUI server scene listing", () => {
	it("asks for a project path before scanning", async () => {
		const listScenes = vi.fn();
		const { base } = await start({ listScenes });

		const response = await fetch(
			`${base}/api/scenes`,
			authorized({ projectPath: "   " }),
		);

		expect(response.status).toBe(400);
		expect(listScenes).not.toHaveBeenCalled();
	});

	it("returns the grouped Scene list", async () => {
		const entries = [
			{
				sceneName: "Main",
				assetPaths: ["Assets/Main.unity"],
				selectable: true,
			},
		];
		const { base } = await start({ listScenes: async () => entries });

		const response = await fetch(
			`${base}/api/scenes`,
			authorized({ projectPath: "D:\\proj" }),
		);

		expect(await response.json()).toEqual({ scenes: entries });
	});

	it("reports a scan failure as a message instead of a 500", async () => {
		const { base } = await start({
			listScenes: async () => {
				throw new Error("EPERM");
			},
		});

		const response = await fetch(
			`${base}/api/scenes`,
			authorized({ projectPath: "D:\\proj" }),
		);
		const body = (await response.json()) as { message: string };

		expect(response.status).toBe(400);
		expect(body.message).toContain("EPERM");
	});
});

describe("GUI server folder picker", () => {
	it("returns null when the dialog is cancelled", async () => {
		const { base } = await start({ pickFolder: async () => ok(undefined) });

		const response = await fetch(`${base}/api/pick-folder`, authorized({}));

		expect(await response.json()).toEqual({ path: null });
	});

	it("passes the current value as the starting folder", async () => {
		const pickFolder = vi.fn(async () => ok("D:\\picked"));
		const { base } = await start({ pickFolder });

		const response = await fetch(
			`${base}/api/pick-folder`,
			authorized({ startPath: "D:\\proj" }),
		);

		expect(await response.json()).toEqual({ path: "D:\\picked" });
		expect(pickFolder).toHaveBeenCalledWith({ startPath: "D:\\proj" });
	});
});

describe("GUI server run", () => {
	it("starts the run with the posted selection", async () => {
		const runCheck = vi.fn(async () => 0 as const);
		const runner = new GuiRunner({
			configPath: CONFIG_PATH,
			writeConfig: async () => {},
			runCheck,
		});
		const { base } = await start({ runner });

		const response = await fetch(
			`${base}/api/run`,
			authorized({
				mode: "check",
				state: {
					...defaultGuiState,
					projectPath: "D:\\proj",
					outputDirectory: "D:\\out",
					selectedScenes: ["Main"],
				},
			}),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ configPath: CONFIG_PATH });
	});

	it("returns the validation issues without starting anything", async () => {
		const runCheck = vi.fn();
		const runner = new GuiRunner({
			configPath: CONFIG_PATH,
			writeConfig: async () => {},
			runCheck,
		});
		const { base } = await start({ runner });

		const response = await fetch(
			`${base}/api/run`,
			authorized({ mode: "check", state: defaultGuiState }),
		);
		const body = (await response.json()) as {
			issues: { path: string; message: string }[];
		};

		expect(response.status).toBe(400);
		expect(body.issues.map((issue) => issue.path)).toEqual([
			"projectPath",
			"scenes",
			"output.directory",
		]);
		expect(runCheck).not.toHaveBeenCalled();
	});
});

describe("GUI server event stream", () => {
	it("streams run events to the page", async () => {
		const { base, runner } = await start();

		const message = await rawGet(base, `/api/events?t=${TOKEN}`, {});
		expect(message.headers["content-type"]).toContain("text/event-stream");

		const firstChunk = new Promise<string>((resolve) => {
			message.on("data", (chunk: Buffer) => resolve(chunk.toString("utf8")));
		});
		runner.log("こんにちは");

		expect(await firstChunk).toContain("こんにちは");
		message.destroy();
	});
});

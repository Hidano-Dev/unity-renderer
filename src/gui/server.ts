import { randomUUID, timingSafeEqual } from "node:crypto";
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import { pickFolder as pickFolderDefault } from "./folder-picker.js";
import { renderPage } from "./page.js";
import { GuiRunner, type RunMode } from "./runner.js";
import { listGuiScenes as listGuiScenesDefault } from "./scenes.js";
import {
	type GuiState,
	type GuiStatePathOptions,
	loadGuiState as loadGuiStateDefault,
	sanitizeGuiState,
	saveGuiState as saveGuiStateDefault,
} from "./state.js";

/** リクエストボディの上限。GUI が送る JSON は数 KB で足りる。 */
const MAX_BODY_BYTES = 1_000_000;

const SSE_KEEPALIVE_MS = 25_000;

export interface GuiServerDeps {
	readonly configPath: string;
	readonly token?: string;
	readonly statePathOptions?: GuiStatePathOptions;
	readonly runner?: GuiRunner;
	readonly listScenes?: typeof listGuiScenesDefault;
	readonly pickFolder?: typeof pickFolderDefault;
	readonly loadState?: typeof loadGuiStateDefault;
	readonly saveState?: typeof saveGuiStateDefault;
}

export interface GuiServer {
	readonly server: Server;
	readonly token: string;
	readonly runner: GuiRunner;
}

function json(response: ServerResponse, status: number, body: unknown): void {
	const payload = JSON.stringify(body);
	response.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
	});
	response.end(payload);
}

async function readBody(request: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of request) {
		const buffer = chunk as Buffer;
		size += buffer.length;
		if (size > MAX_BODY_BYTES) throw new Error("リクエストが大きすぎます");
		chunks.push(buffer);
	}
	if (size === 0) return {};
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function tokenMatches(expected: string, actual: string | undefined): boolean {
	if (actual === undefined) return false;
	const expectedBytes = Buffer.from(expected, "utf8");
	const actualBytes = Buffer.from(actual, "utf8");
	if (expectedBytes.length !== actualBytes.length) return false;
	return timingSafeEqual(expectedBytes, actualBytes);
}

/**
 * ループバックにしか bind しないが、それだけではブラウザ経由の攻撃を防げない。
 * 任意のサイトが `http://127.0.0.1:<port>/api/run` を叩けるため、トークンを
 * 必須にする。加えて Host が別名(DNS リバインディング)でないことも確認する。
 */
function isLoopbackHost(hostHeader: string | undefined): boolean {
	if (hostHeader === undefined) return false;
	const host = hostHeader.replace(/:\d+$/u, "").replace(/^\[|\]$/gu, "");
	return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function requestUrl(request: IncomingMessage): URL {
	return new URL(request.url ?? "/", "http://127.0.0.1");
}

export function createGuiServer(deps: GuiServerDeps): GuiServer {
	const token = deps.token ?? randomUUID();
	const statePathOptions = deps.statePathOptions ?? {};
	const listScenes = deps.listScenes ?? listGuiScenesDefault;
	const pickFolder = deps.pickFolder ?? pickFolderDefault;
	const loadState = deps.loadState ?? loadGuiStateDefault;
	const saveState = deps.saveState ?? saveGuiStateDefault;
	const runner = deps.runner ?? new GuiRunner({ configPath: deps.configPath });

	async function persist(state: GuiState): Promise<void> {
		const saved = await saveState(state, statePathOptions);
		// 保存できなくても操作は続けられるべきなので、ログに残して進む
		if (!saved.ok) runner.log(`警告: ${saved.error.message}`);
	}

	function streamEvents(response: ServerResponse): void {
		response.writeHead(200, {
			"content-type": "text/event-stream; charset=utf-8",
			"cache-control": "no-store",
			connection: "keep-alive",
		});
		// writeHead だけではヘッダーが送られず、最初のイベントが起きるまで
		// EventSource の接続が確立しない。実行前は何も流れないので、明示的に流す
		response.flushHeaders();
		const unsubscribe = runner.subscribe((event) => {
			response.write(`data: ${JSON.stringify(event)}\n\n`);
		});
		// プロキシや OS がアイドル接続を切るのを防ぐ
		const keepAlive = setInterval(
			() => response.write(": ping\n\n"),
			SSE_KEEPALIVE_MS,
		);
		const stop = (): void => {
			clearInterval(keepAlive);
			unsubscribe();
		};
		response.on("close", stop);
		response.on("error", stop);
	}

	async function route(
		request: IncomingMessage,
		response: ServerResponse,
	): Promise<void> {
		const url = requestUrl(request);
		const method = request.method ?? "GET";

		if (url.pathname === "/" && method === "GET") {
			response.writeHead(200, {
				"content-type": "text/html; charset=utf-8",
				"cache-control": "no-store",
			});
			response.end(renderPage(token));
			return;
		}

		if (url.pathname === "/api/events" && method === "GET") {
			streamEvents(response);
			return;
		}

		if (url.pathname === "/api/state" && method === "GET") {
			json(response, 200, { state: await loadState(statePathOptions) });
			return;
		}

		if (url.pathname === "/api/state" && method === "PUT") {
			const state = sanitizeGuiState(await readBody(request));
			await persist(state);
			json(response, 200, { state });
			return;
		}

		if (url.pathname === "/api/scenes" && method === "POST") {
			const body = (await readBody(request)) as { projectPath?: unknown };
			const projectPath =
				typeof body.projectPath === "string" ? body.projectPath.trim() : "";
			if (projectPath === "") {
				json(response, 400, {
					message: "Unity プロジェクトのフォルダを指定してください",
				});
				return;
			}
			try {
				json(response, 200, { scenes: await listScenes(projectPath) });
			} catch (cause) {
				json(response, 400, {
					message: `Scene を読み込めませんでした: ${cause instanceof Error ? cause.message : String(cause)}`,
				});
			}
			return;
		}

		if (url.pathname === "/api/pick-folder" && method === "POST") {
			const body = (await readBody(request)) as { startPath?: unknown };
			const picked = await pickFolder({
				startPath:
					typeof body.startPath === "string" && body.startPath.trim() !== ""
						? body.startPath
						: undefined,
			});
			if (!picked.ok) {
				json(response, 400, { message: picked.error.message });
				return;
			}
			json(response, 200, { path: picked.value ?? null });
			return;
		}

		if (url.pathname === "/api/run" && method === "POST") {
			const body = (await readBody(request)) as {
				mode?: unknown;
				state?: unknown;
			};
			const mode: RunMode = body.mode === "render" ? "render" : "check";
			const state = sanitizeGuiState(body.state);
			await persist(state);
			const started = await runner.start(mode, state, state.selectedScenes);
			if (!started.ok) {
				json(response, 400, {
					message: "設定を確認してください",
					issues: started.error,
				});
				return;
			}
			json(response, 200, { configPath: started.value.configPath });
			return;
		}

		json(response, 404, { message: "not found" });
	}

	const server = createServer((request, response) => {
		void (async () => {
			try {
				if (!isLoopbackHost(request.headers.host)) {
					json(response, 403, { message: "forbidden" });
					return;
				}
				const url = requestUrl(request);
				const supplied =
					(request.headers["x-gui-token"] as string | undefined) ??
					url.searchParams.get("t") ??
					undefined;
				if (!tokenMatches(token, supplied)) {
					json(response, 401, { message: "unauthorized" });
					return;
				}
				await route(request, response);
			} catch (cause) {
				if (response.headersSent) {
					response.end();
					return;
				}
				json(response, 500, {
					message: cause instanceof Error ? cause.message : String(cause),
				});
			}
		})();
	});

	return { server, token, runner };
}

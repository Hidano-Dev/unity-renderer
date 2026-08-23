import { createServer, type Server } from "node:http";
import { describe, expect, it } from "vitest";
import { createPipelineClient } from "../../src/editor-session/pipeline-client.js";
import { createEditorSession } from "../../src/editor-session/session.js";

const editor = {
	version: { raw: "6000.0.36f1", major: 6000 },
	executablePath: "C:\\Unity\\Editor\\Unity.exe",
};

async function closeServer(server: Server): Promise<void> {
	await new Promise<void>((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve())),
	);
}

describe("editor-session integration", () => {
	it("retries connection to the fake pipeline server and evaluates a payload", async () => {
		let requests = 0;
		let server: Server | undefined;
		const session = createEditorSession({
			// マシン全体のポートロックはテスト対象外(テスト間の相互干渉を避ける)
			portLockPath: null,
			spawn: () => {
				server = createServer((request, response) => {
					if (request.url === "/api/editor_status") {
						requests += 1;
						response.writeHead(200).end("ready");
						return;
					}
					response.writeHead(404).end();
				}).listen(7800, "127.0.0.1");
				return { pid: 1234 };
			},
			isPortInUse: async () => false,
			isReachable: async (url) => {
				try {
					const result = await fetch(url);
					return result.ok;
				} catch {
					return false;
				}
			},
			sleep: async () => undefined,
		});

		try {
			const started = await session.start(editor, "C:\\projects\\demo", 1);
			expect(started.ok).toBe(true);
			expect(requests).toBeGreaterThan(0);

			const calls: string[] = [];
			const pipeline = createPipelineClient({
				projectPath: "C:\\projects\\demo",
				sessionDir: "unused",
				execute: async (_command, args) => {
					calls.push(args[1] ?? "");
					return {
						stdout: JSON.stringify({ result: { success: true, result: "ok" } }),
						stderr: "",
						exitCode: 0,
					};
				},
			});
			const evaluated = await pipeline.eval(
				{ id: "start-recording", source: "return;" },
				{ timeoutSec: 1, transport: { kind: "inline" } },
			);
			expect(evaluated).toEqual({ ok: true, value: { returnValue: "ok" } });
			expect(calls).toEqual(["eval"]);
		} finally {
			if (server) await closeServer(server);
		}
	});

	it("kills the fake Editor when connection never becomes available", async () => {
		const killed: number[] = [];
		const session = createEditorSession({
			// マシン全体のポートロックはテスト対象外(テスト間の相互干渉を避ける)
			portLockPath: null,
			spawn: () => ({ pid: 5678 }),
			isPortInUse: async () => false,
			isReachable: async () => false,
			killProcess: async (pid) => void killed.push(pid),
			sleep: async () => undefined,
			pollIntervalMs: 1,
		});

		const result = await session.start(editor, "C:\\projects\\demo", 0.001);

		expect(result).toEqual({
			ok: false,
			error: expect.objectContaining({ kind: "connect-timeout" }),
		});
		expect(killed).toEqual([5678]);
		expect(session.state).toBe("terminated");
	});
});

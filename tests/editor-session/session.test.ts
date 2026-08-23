import type { ChildProcess } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
	createEditorSession,
	type SessionDependencies,
} from "../../src/editor-session/session.js";

const editor = {
	version: { raw: "6000.0.36f1", major: 6000 },
	executablePath: "C:\\Unity\\Editor\\Unity.exe",
};

function dependencies(overrides: Partial<SessionDependencies> = {}) {
	const child = { pid: 1234 } as ChildProcess;
	return {
		spawn: vi.fn(() => child),
		isPortInUse: vi.fn(async () => false),
		isReachable: vi.fn(async () => true),
		killProcess: vi.fn(async () => undefined),
		sleep: vi.fn(async () => undefined),
		...overrides,
	};
}

describe("EditorSession", () => {
	it("starts a pinned GUI Editor and waits for the pipeline connection", async () => {
		const deps = dependencies();
		const session = createEditorSession(deps);

		const result = await session.start(editor, "C:\\projects\\demo", 2);

		expect(result.ok).toBe(true);
		expect(deps.spawn).toHaveBeenCalledWith(
			"unity",
			[
				"open",
				"C:\\projects\\demo",
				"--editor-version",
				"6000.0.36f1",
				"--args=-automated",
			],
			{ windowsHide: true },
		);
		expect(session.state).toBe("connected");
	});

	it("fails before launch when port 7800 is already occupied", async () => {
		const deps = dependencies({ isPortInUse: vi.fn(async () => true) });
		const session = createEditorSession(deps);

		const result = await session.start(editor, "C:\\projects\\demo", 2);

		expect(result).toEqual({
			ok: false,
			error: expect.objectContaining({ kind: "port-conflict" }),
		});
		expect(deps.spawn).not.toHaveBeenCalled();
		expect(session.state).toBe("terminated");
	});

	it("kills the Editor when the connection timeout expires", async () => {
		const deps = dependencies({ isReachable: vi.fn(async () => false) });
		const session = createEditorSession({ ...deps, pollIntervalMs: 1 });

		const result = await session.start(editor, "C:\\projects\\demo", 0.001);

		expect(result).toEqual({
			ok: false,
			error: expect.objectContaining({ kind: "connect-timeout" }),
		});
		expect(deps.killProcess).toHaveBeenCalledWith(1234);
		expect(session.state).toBe("terminated");
	});

	it("flags a failed kill on the connection timeout path", async () => {
		const deps = dependencies({
			isReachable: vi.fn(async () => false),
			isProcessAlive: vi.fn(async () => true),
			killProcess: vi.fn(async () => {
				throw new Error("access denied");
			}),
			pollIntervalMs: 1,
		});
		const session = createEditorSession(deps);

		const result = await session.start(editor, "C:\\projects\\demo", 0.001);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.kind).toBe("connect-timeout");
			// 生存 Editor をバッチへ伝えないと、後続 Scene と復元が競合する
			expect(result.error.terminationFailed).toBe(true);
		}
	});

	it("makes kill idempotent", async () => {
		const deps = dependencies();
		const session = createEditorSession(deps);

		await session.start(editor, "C:\\projects\\demo", 2);
		await session.kill();
		await session.kill();

		expect(deps.killProcess).toHaveBeenCalledTimes(1);
		expect(session.state).toBe("terminated");
	});

	it("sends the quit payload and waits for a graceful Editor exit", async () => {
		const isProcessAlive = vi
			.fn()
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false);
		const deps = dependencies({
			requestQuit: vi.fn(async () => undefined),
			isProcessAlive,
			pollIntervalMs: 1,
		});
		const session = createEditorSession(deps);
		await session.start(editor, "C:\\projects\\demo", 2);

		await session.quit(1);

		expect(deps.requestQuit).toHaveBeenCalledOnce();
		expect(deps.killProcess).not.toHaveBeenCalled();
		expect(session.state).toBe("terminated");
	});

	it("does not report terminated when the force-kill fails and the process survives", async () => {
		const deps = dependencies({
			requestQuit: vi.fn(async () => undefined),
			isProcessAlive: vi.fn(async () => true),
			killProcess: vi.fn(async () => {
				throw new Error("access denied");
			}),
			pollIntervalMs: 1,
			resolvePidByPort: vi.fn(async () => undefined),
		});
		const session = createEditorSession(deps);
		await session.start(editor, "C:\\projects\\demo", 2);

		await expect(session.quit(0.001)).rejects.toThrow(/強制終了に失敗/);
		expect(session.state).not.toBe("terminated");
	});

	it("force-kills the Editor when graceful quit is blocked", async () => {
		const deps = dependencies({
			requestQuit: vi.fn(async () => undefined),
			isProcessAlive: vi.fn(async () => true),
			pollIntervalMs: 1,
		});
		const session = createEditorSession(deps);
		await session.start(editor, "C:\\projects\\demo", 2);

		await session.quit(0.001);

		expect(deps.requestQuit).toHaveBeenCalledOnce();
		expect(deps.killProcess).toHaveBeenCalledWith(1234);
		expect(session.state).toBe("terminated");
	});
});

import { execFile, spawn as spawnProcess } from "node:child_process";
import { promisify } from "node:util";
import { err, ok, type Result } from "../shared/types.js";
import type { EditorInstall } from "../unity-env/editors.js";

const execFileAsync = promisify(execFile);
const PIPELINE_PORT = 7800;
const PIPELINE_HOST = "127.0.0.1";

export interface SessionError {
	readonly kind: "launch-failed" | "connect-timeout" | "port-conflict";
	readonly message: string;
	readonly unityLogExcerpt?: string;
}

export interface SessionDependencies {
	readonly spawn?: (
		command: string,
		args: readonly string[],
		options: { readonly windowsHide: boolean },
	) => Pick<ReturnType<typeof spawnProcess>, "pid">;
	readonly isPortInUse?: (port: number) => Promise<boolean>;
	readonly isReachable?: (url: string) => Promise<boolean>;
	readonly killProcess?: (pid: number) => Promise<void>;
	readonly isProcessAlive?: (pid: number) => Promise<boolean>;
	readonly requestQuit?: () => Promise<void>;
	readonly sleep?: (milliseconds: number) => Promise<void>;
	readonly pollIntervalMs?: number;
}

export interface EditorSession {
	readonly state: "starting" | "connected" | "terminated";
	start(
		editor: EditorInstall,
		projectPath: string,
		timeoutSec: number,
	): Promise<Result<void, SessionError>>;
	quit(timeoutSec: number): Promise<void>;
	kill(): Promise<void>;
}

function defaultSleep(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function defaultIsPortInUse(port: number): Promise<boolean> {
	const { createConnection } = await import("node:net");
	return new Promise((resolve) => {
		const socket = createConnection({ host: PIPELINE_HOST, port });
		const finish = (value: boolean) => {
			socket.destroy();
			resolve(value);
		};
		socket.once("connect", () => finish(true));
		socket.once("error", () => finish(false));
	});
}

async function defaultIsReachable(url: string): Promise<boolean> {
	try {
		const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
		return response.ok || response.status < 500;
	} catch {
		return false;
	}
}

async function defaultKillProcess(pid: number): Promise<void> {
	if (process.platform === "win32") {
		await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"], {
			windowsHide: true,
		});
		return;
	}
	process.kill(pid, "SIGKILL");
}

async function defaultIsProcessAlive(pid: number): Promise<boolean> {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

export function createEditorSession(
	dependencies: SessionDependencies = {},
): EditorSession {
	let currentState: EditorSession["state"] = "terminated";
	let pid: number | undefined;
	let killPromise: Promise<void> | undefined;
	const spawn =
		dependencies.spawn ??
		((command, args, options) => spawnProcess(command, [...args], options));
	const isPortInUse = dependencies.isPortInUse ?? defaultIsPortInUse;
	const isReachable = dependencies.isReachable ?? defaultIsReachable;
	const killProcess = dependencies.killProcess ?? defaultKillProcess;
	const isProcessAlive = dependencies.isProcessAlive ?? defaultIsProcessAlive;
	const requestQuit = dependencies.requestQuit ?? (async () => undefined);
	const sleep = dependencies.sleep ?? defaultSleep;
	const pollIntervalMs = dependencies.pollIntervalMs ?? 2_000;

	const kill = async (): Promise<void> => {
		if (killPromise) return killPromise;
		const processId = pid;
		if (processId === undefined) {
			currentState = "terminated";
			return;
		}
		killPromise = (async () => {
			try {
				await killProcess(processId);
			} catch {
				// A process that already exited is the desired terminal state.
			}
			pid = undefined;
			currentState = "terminated";
		})();
		return killPromise;
	};

	return {
		get state() {
			return currentState;
		},
		async start(editor, projectPath, timeoutSec) {
			killPromise = undefined;
			if (await isPortInUse(PIPELINE_PORT)) {
				currentState = "terminated";
				return err({
					kind: "port-conflict",
					message:
						"localhost:7800 は既に使用中です。既存の Unity Editor を閉じてください。",
				});
			}

			currentState = "starting";
			try {
				const child = spawn(
					"unity",
					[
						"open",
						"--path",
						projectPath,
						"--editor-version",
						editor.version.raw,
						"--",
						"-automated",
					],
					{ windowsHide: true },
				);
				if (child.pid === undefined)
					throw new Error("Unity process PID is unavailable");
				pid = child.pid;
			} catch (cause) {
				currentState = "terminated";
				return err({
					kind: "launch-failed",
					message: `Unity Editor の起動に失敗しました: ${cause instanceof Error ? cause.message : String(cause)}`,
				});
			}

			const deadline = Date.now() + timeoutSec * 1_000;
			while (Date.now() < deadline) {
				if (
					await isReachable(
						`http://${PIPELINE_HOST}:${PIPELINE_PORT}/api/editor_status`,
					)
				) {
					currentState = "connected";
					return ok(undefined);
				}
				await sleep(
					Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())),
				);
			}

			await kill();
			return err({
				kind: "connect-timeout",
				message: `Unity Editor への接続が ${timeoutSec} 秒以内に確立できませんでした。Editor.log を確認してください。`,
			});
		},
		async quit(timeoutSec) {
			if (currentState === "terminated" || pid === undefined) {
				currentState = "terminated";
				return;
			}

			try {
				await requestQuit();
			} catch {
				// A blocked or failed quit request is handled by the forced fallback.
			}

			const processId = pid;
			const deadline = Date.now() + timeoutSec * 1_000;
			while (Date.now() < deadline) {
				if (!(await isProcessAlive(processId))) {
					pid = undefined;
					currentState = "terminated";
					return;
				}
				await sleep(
					Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())),
				);
			}

			await kill();
		},
		kill,
	};
}

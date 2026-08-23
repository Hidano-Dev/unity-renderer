import { execFile, spawn as spawnProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { checkProjectLock } from "../project-guard/lock.js";
import {
	acquireExclusiveLock,
	releaseExclusiveLock,
} from "../shared/exclusive-lock.js";
import { resolveToolDirectory } from "../shared/paths.js";
import { err, ok, type Result } from "../shared/types.js";
import type { EditorInstall } from "../unity-env/editors.js";

const execFileAsync = promisify(execFile);
const PIPELINE_PORT = 7800;
const PIPELINE_HOST = "127.0.0.1";

/**
 * ポート 7800 は固定・共有資源のため、「占有チェック → 接続確立 → Editor 終了」
 * までをマシン全体で直列化する。これが無いと、別プロジェクトの render が 2 つ
 * 同時にチェックを通過し、先に listen した 1 つの Editor を双方が自分の接続先と
 * 受理してしまう(同じ PID を追跡し、片方の終了処理がもう片方の Editor を kill
 * する)。
 */
const PORT_LOCK_FILE = "pipeline-port-7800.lock";

export interface SessionError {
	readonly kind: "launch-failed" | "connect-timeout" | "port-conflict";
	readonly message: string;
	readonly unityLogExcerpt?: string;
	/**
	 * Editor プロセスを終了できず生存したまま残った。呼び出し側はバッチを
	 * 中断し、生存 Editor と並行してパッケージ復元を行ってはならない。
	 */
	readonly terminationFailed?: boolean;
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
	readonly resolvePidByPort?: (port: number) => Promise<number | undefined>;
	/** プロジェクトを開いている Editor が生存しているか(Temp/UnityLockfile の所有)。 */
	readonly isProjectLocked?: (projectPath: string) => Promise<boolean>;
	/** ポート 7800 の占有をマシン全体で直列化するロック。テストで無効化できる。 */
	readonly portLockPath?: string | null;
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
	} catch (cause) {
		// EPERM は「プロセスは存在するがシグナル送信権限が無い」。死亡と誤判定すると
		// 生存 Editor を終了済みとみなし、後続 Scene と復元が並行してしまう
		return (cause as NodeJS.ErrnoException).code === "EPERM";
	}
}

async function defaultResolvePidByPort(
	port: number,
): Promise<number | undefined> {
	if (process.platform !== "win32") return undefined;
	try {
		const { stdout } = await execFileAsync("netstat", ["-ano", "-p", "tcp"], {
			windowsHide: true,
		});
		const match = stdout.match(
			new RegExp(`:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`, "u"),
		);
		const pid = match?.[1] !== undefined ? Number(match[1]) : Number.NaN;
		return Number.isInteger(pid) && pid > 0 ? pid : undefined;
	} catch {
		return undefined;
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
	const resolvePidByPort =
		dependencies.resolvePidByPort ?? defaultResolvePidByPort;
	const isProjectLocked =
		dependencies.isProjectLocked ??
		(async (projectPath: string) => !(await checkProjectLock(projectPath)).ok);
	const resolvePortLockPath = (): string | undefined => {
		if (dependencies.portLockPath === null) return undefined;
		if (dependencies.portLockPath !== undefined)
			return dependencies.portLockPath;
		const toolDirectory = resolveToolDirectory();
		return toolDirectory.ok
			? join(toolDirectory.value, PORT_LOCK_FILE)
			: undefined;
	};
	const ensureLockDirectory = async (lockPath: string): Promise<boolean> => {
		// 初回実行ではツールディレクトリが未作成で、ロックの一時ファイル書き込みが
		// ENOENT になる
		try {
			await mkdir(dirname(lockPath), { recursive: true });
			return true;
		} catch {
			return false;
		}
	};
	let heldPortLock: string | undefined;
	const releasePortLock = async (): Promise<void> => {
		if (!heldPortLock) return;
		const lockPath = heldPortLock;
		heldPortLock = undefined;
		await releaseExclusiveLock(lockPath).catch(() => undefined);
	};

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
			} catch (cause) {
				// A process that already exited is the desired terminal state, but a
				// kill failure (access denied, transient OS error) must not be treated
				// as terminated: the Editor would keep port 7800 and corrupt the next
				// Scene. Verify liveness before deciding.
				if (await isProcessAlive(processId)) {
					killPromise = undefined;
					throw new Error(
						`Unity Editor (PID ${processId}) の強制終了に失敗しました。プロセスを手動で終了してください: ${cause instanceof Error ? cause.message : String(cause)}`,
					);
				}
			}
			pid = undefined;
			currentState = "terminated";
			await releasePortLock();
		})();
		return killPromise;
	};

	return {
		get state() {
			return currentState;
		},
		async start(editor, projectPath, timeoutSec) {
			killPromise = undefined;
			// 占有チェックから接続確立までを直列化する。ロックを取らないと、別
			// プロジェクトの render と同時にチェックを通過し、同じ Editor を双方が
			// 自分の接続先として受理してしまう
			const portLockPath = resolvePortLockPath();
			if (portLockPath && (await ensureLockDirectory(portLockPath))) {
				const locked = await acquireExclusiveLock(portLockPath, {
					heldMessage:
						"別の unity-render 実行が Unity Editor を起動中です (ポート 7800 は共有資源のため同時実行できません)。",
					staleMessage:
						"直前の実行が残したポートロックを検出しました。30 秒ほど待って再実行してください。",
				});
				if (!locked.ok) {
					currentState = "terminated";
					return err({ kind: "port-conflict", message: locked.error.message });
				}
				heldPortLock = locked.value;
			}
			if (await isPortInUse(PIPELINE_PORT)) {
				currentState = "terminated";
				await releasePortLock();
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
						projectPath,
						"--editor-version",
						editor.version.raw,
						"--args=-automated",
					],
					{ windowsHide: true },
				);
				if (child.pid === undefined)
					throw new Error("Unity process PID is unavailable");
				pid = child.pid;
			} catch (cause) {
				currentState = "terminated";
				await releasePortLock();
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
					// unity open が返す PID は短命なランチャーのもの。quit / kill を
					// Editor 本体へ効かせるため、7800 を Listen する実プロセスに差し替える
					pid = (await resolvePidByPort(PIPELINE_PORT)) ?? pid;
					currentState = "connected";
					return ok(undefined);
				}
				await sleep(
					Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())),
				);
			}

			// 追跡している PID は短命なランチャーのものかもしれない。7800 を握る
			// 実プロセスが判明すればそちらを終了対象にする
			pid = (await resolvePidByPort(PIPELINE_PORT)) ?? pid;
			let killNote = "";
			let terminationFailed = false;
			await kill().catch((cause) => {
				terminationFailed = true;
				killNote = ` さらに ${cause instanceof Error ? cause.message : String(cause)}`;
			});
			// ランチャーの終了は Editor 本体の終了を意味しない。ポート占有と
			// プロジェクトロックで生存 Editor の有無を確かめ、残っていれば
			// バッチを止められるよう terminationFailed として報告する
			if (!terminationFailed) {
				const portHeld = await isPortInUse(PIPELINE_PORT);
				const projectHeld = await isProjectLocked(projectPath).catch(
					() => false,
				);
				if (portHeld || projectHeld) {
					terminationFailed = true;
					killNote = portHeld
						? " 7800 番ポートを占有するプロセスが残っています。Unity Editor を手動で終了してください。"
						: " プロジェクトを開いたままの Unity Editor が残っています。手動で終了してください。";
				}
			}
			return err({
				kind: "connect-timeout",
				message: `Unity Editor への接続が ${timeoutSec} 秒以内に確立できませんでした。Editor.log を確認してください。${killNote}`,
				...(terminationFailed ? { terminationFailed } : {}),
			});
		},
		async quit(timeoutSec) {
			if (currentState === "terminated" || pid === undefined) {
				currentState = "terminated";
				await releasePortLock();
				return;
			}

			// 期限は quit 要求の前に確定させる。要求(eval)と終了待機で別々に
			// timeoutSec を使うと、契約上の「N 秒以内に終了しなければ強制終了」が
			// 最大 2N 秒に伸び、Scene ごとにバッチが長時間停止する
			const deadline = Date.now() + timeoutSec * 1_000;
			try {
				await requestQuit();
			} catch {
				// A blocked or failed quit request is handled by the forced fallback.
			}

			const processId = pid;
			while (Date.now() < deadline) {
				if (!(await isProcessAlive(processId))) {
					pid = undefined;
					currentState = "terminated";
					// Editor が終了して初めてポートが空く。ここで初めて解放する
					await releasePortLock();
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

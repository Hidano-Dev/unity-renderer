import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { access, copyFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { resolveSessionDirectory } from "../shared/paths.js";
import { err, ok, type Result } from "../shared/types.js";
import {
	acquireBeginLock,
	type BackupSession,
	type GuardError,
	projectIdentityKey,
	readBackupSession,
	releaseBeginLock,
	sessionMatchesProject,
	writeBackupSession,
} from "./backup.js";

/** @impl URC-6.3 @impl URC-6.4 @impl URC-6.5 */
export interface RecoveryOptions {
	readonly sessionRoot?: string;
	readonly isProcessAlive?: (pid: number) => boolean;
}

function defaultIsProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (cause) {
		// EPERM はプロセスが存在するがシグナル送信権限が無い場合
		return (cause as NodeJS.ErrnoException).code === "EPERM";
	}
}

async function atomicRestore(source: string, target: string): Promise<void> {
	const temporary = `${target}.${randomUUID()}.restore.tmp`;
	try {
		await copyFile(source, temporary);
		await rename(temporary, target);
	} finally {
		await rm(temporary, { force: true });
	}
}

function restoreFailure(
	message: string,
	cause: unknown,
): Result<never, GuardError> {
	return err({
		kind: "restore-failed",
		message,
		cause,
		manualRecoveryHint:
			"Keep the active session directory and retry recovery before running another render.",
	});
}

export async function restoreSession(
	session: BackupSession,
): Promise<Result<void, GuardError>> {
	try {
		for (const file of session.files) {
			const target = path.join(session.projectPath, file.relativePath);
			const backup = path.join(session.sessionDirectory, file.backupFileName);
			if (file.exists) {
				await access(backup);
				await atomicRestore(backup, target);
			} else {
				await rm(target, { force: true });
			}
		}
		const restored = { ...session, status: "restored" as const };
		await writeBackupSession(restored);
		await rm(session.sessionDirectory, { recursive: true, force: true });
		return ok(undefined);
	} catch (cause) {
		return restoreFailure(
			"Project manifest restoration failed; the active session was retained for retry.",
			cause,
		);
	}
}

export async function detectStaleSessions(
	options: RecoveryOptions = {},
): Promise<readonly BackupSession[]> {
	const rootResult =
		options.sessionRoot === undefined
			? resolveSessionDirectory()
			: ok(options.sessionRoot);
	if (!rootResult.ok) return [];
	let entries: Dirent<string>[];
	try {
		entries = await readdir(rootResult.value, { withFileTypes: true });
	} catch {
		return [];
	}
	const isAlive = options.isProcessAlive ?? defaultIsProcessAlive;
	const sessions: BackupSession[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		try {
			const session = await readBackupSession(
				path.join(rootResult.value, entry.name),
			);
			if (session.status !== "active") continue;
			// 所有プロセスが生存している active セッションは実行中であり、
			// クラッシュ残骸ではない(復旧すると稼働中の CLI の状態を破壊する)。
			// 自プロセス PID も同様に保護する(同一プロセス内の並走実行)。稀な
			// PID 再利用による見逃しは beginProjectSession の同時実行拒否が止める
			const ownedByLiveProcess =
				session.ownerPid !== undefined && isAlive(session.ownerPid);
			if (!ownedByLiveProcess) sessions.push(session);
		} catch {
			// A partial metadata file cannot safely identify a project and is left untouched.
		}
	}
	return sessions;
}

/**
 * クラッシュ残骸の復元を、新規セッション開始と同じプロジェクトロックの下で
 * 直列化する。ロックがないと、同時起動した 2 つの CLI が同じ stale session を
 * 復元し、先行プロセスが開始した新セッションの manifest を後発プロセスが
 * 古いバックアップで上書きし得る(稼働中 render から Recorder / Pipeline
 * パッケージが消える)。
 */
export async function recoverStaleSessions(
	projectPath: string,
	options: RecoveryOptions = {},
): Promise<Result<readonly BackupSession[], GuardError>> {
	const rootResult =
		options.sessionRoot === undefined
			? resolveSessionDirectory()
			: ok(options.sessionRoot);
	if (!rootResult.ok)
		// セッションディレクトリを解決できない環境では復旧対象も存在しない
		return ok([]);
	const isAlive = options.isProcessAlive ?? defaultIsProcessAlive;
	const projectKey = await projectIdentityKey(projectPath);
	const lock = await acquireBeginLock(rootResult.value, projectKey, isAlive);
	if (!lock.ok) return lock;
	try {
		const sessions = (await detectStaleSessions(options)).filter((session) =>
			sessionMatchesProject(session, projectKey),
		);
		const recovered: BackupSession[] = [];
		for (const session of sessions) {
			const result = await restoreSession(session);
			if (!result.ok) return result;
			recovered.push(session);
		}
		return ok(recovered);
	} finally {
		await releaseBeginLock(lock.value);
	}
}

export async function recoverProject(
	projectPath: string,
	options: RecoveryOptions = {},
): Promise<Result<readonly BackupSession[], GuardError>> {
	return recoverStaleSessions(projectPath, options);
}

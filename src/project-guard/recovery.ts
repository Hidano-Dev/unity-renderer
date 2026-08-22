import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { access, copyFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { resolveSessionDirectory } from "../shared/paths.js";
import { err, ok, type Result } from "../shared/types.js";
import {
	type BackupSession,
	type GuardError,
	readBackupSession,
	writeBackupSession,
} from "./backup.js";

/** @impl URC-6.3 @impl URC-6.4 @impl URC-6.5 */
export interface RecoveryOptions {
	readonly sessionRoot?: string;
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
	const sessions: BackupSession[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		try {
			const session = await readBackupSession(
				path.join(rootResult.value, entry.name),
			);
			if (session.status === "active") sessions.push(session);
		} catch {
			// A partial metadata file cannot safely identify a project and is left untouched.
		}
	}
	return sessions;
}

export async function recoverStaleSessions(
	projectPath: string,
	options: RecoveryOptions = {},
): Promise<Result<readonly BackupSession[], GuardError>> {
	const sessions = (await detectStaleSessions(options)).filter(
		(session) =>
			path.resolve(session.projectPath) === path.resolve(projectPath),
	);
	const recovered: BackupSession[] = [];
	for (const session of sessions) {
		const result = await restoreSession(session);
		if (!result.ok) return result;
		recovered.push(session);
	}
	return ok(recovered);
}

export async function recoverProject(
	projectPath: string,
	options: RecoveryOptions = {},
): Promise<Result<readonly BackupSession[], GuardError>> {
	return recoverStaleSessions(projectPath, options);
}

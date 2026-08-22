import { createHash, randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import {
	access,
	copyFile,
	mkdir,
	readdir,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { resolveSessionDirectory } from "../shared/paths.js";
import { err, ok, type Result } from "../shared/types.js";
import { type AddedPackage, patchManifest } from "./manifest-patch.js";

export interface BackupFile {
	readonly relativePath: string;
	readonly backupFileName: string;
	readonly sha256: string;
	readonly exists: boolean;
}
export interface BackupSession {
	readonly version: 1;
	readonly projectPath: string;
	readonly createdAt: string;
	readonly status: "active" | "restored";
	readonly sessionDirectory: string;
	readonly files: readonly BackupFile[];
	readonly addedPackages: readonly AddedPackage[];
}
export interface GuardError {
	readonly kind:
		| "backup-failed"
		| "restore-failed"
		| "manifest-patch-failed"
		| "io-error";
	readonly message: string;
	readonly cause?: unknown;
	readonly manualRecoveryHint?: string;
}
export interface BackupOptions {
	readonly sessionRoot?: string;
	readonly now?: () => Date;
}
const manifestFiles = [
	{
		relativePath: "Packages/manifest.json",
		backupFileName: "manifest.json",
		required: true,
	},
	{
		relativePath: "Packages/packages-lock.json",
		backupFileName: "packages-lock.json",
		required: false,
	},
] as const;
function failure(
	kind: GuardError["kind"],
	message: string,
	cause?: unknown,
): Result<never, GuardError> {
	return err({ kind, message, cause });
}
function hash(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}
async function atomicWriteJson(
	filePath: string,
	value: unknown,
): Promise<void> {
	const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
	try {
		await writeFile(
			temporaryPath,
			`${JSON.stringify(value, null, 2)}\n`,
			"utf8",
		);
		await rename(temporaryPath, filePath);
	} finally {
		await rm(temporaryPath, { force: true });
	}
}
export async function writeBackupSession(
	session: BackupSession,
): Promise<void> {
	await atomicWriteJson(
		path.join(session.sessionDirectory, "session.json"),
		session,
	);
}
export async function readBackupSession(
	sessionDirectory: string,
): Promise<BackupSession> {
	return JSON.parse(
		await readFile(path.join(sessionDirectory, "session.json"), "utf8"),
	) as BackupSession;
}
function sessionDirectoryName(projectPath: string, now: Date): string {
	const projectHash = createHash("sha256")
		.update(path.resolve(projectPath))
		.digest("hex")
		.slice(0, 12);
	return `${projectHash}-${now.toISOString().replace(/[-:.TZ]/g, "")}`;
}
export async function beginBackupSession(
	projectPath: string,
	options: BackupOptions = {},
): Promise<Result<BackupSession, GuardError>> {
	const rootResult =
		options.sessionRoot === undefined
			? resolveSessionDirectory()
			: ok(options.sessionRoot);
	if (!rootResult.ok) return failure("io-error", rootResult.error.message);
	const now = options.now ?? (() => new Date());
	const sessionDirectory = path.join(
		rootResult.value,
		sessionDirectoryName(projectPath, now()),
	);
	const files: BackupFile[] = [];
	try {
		await mkdir(sessionDirectory, { recursive: true });
		for (const definition of manifestFiles) {
			const source = path.join(projectPath, definition.relativePath);
			let exists = true;
			try {
				await access(source);
			} catch {
				exists = false;
			}
			if (!exists) {
				if (definition.required)
					throw new Error(
						`Required file is missing: ${definition.relativePath}`,
					);
				files.push({
					relativePath: definition.relativePath,
					backupFileName: definition.backupFileName,
					sha256: "",
					exists: false,
				});
				continue;
			}
			const backupPath = path.join(sessionDirectory, definition.backupFileName);
			await copyFile(source, backupPath);
			const [originalBytes, backupBytes] = await Promise.all([
				readFile(source),
				readFile(backupPath),
			]);
			if (Buffer.compare(originalBytes, backupBytes) !== 0)
				throw new Error(
					`Backup verification failed: ${definition.relativePath}`,
				);
			files.push({
				relativePath: definition.relativePath,
				backupFileName: definition.backupFileName,
				sha256: hash(originalBytes),
				exists: true,
			});
		}
		const session: BackupSession = {
			version: 1,
			projectPath: path.resolve(projectPath),
			createdAt: now().toISOString(),
			status: "active",
			sessionDirectory,
			files,
			addedPackages: [],
		};
		await writeBackupSession(session);
		return ok(session);
	} catch (cause) {
		await rm(sessionDirectory, { recursive: true, force: true });
		return failure(
			"backup-failed",
			"Manifest backup failed; no package was added.",
			cause,
		);
	}
}
export async function beginProjectSession(
	projectPath: string,
	options: BackupOptions = {},
): Promise<Result<BackupSession, GuardError>> {
	const activeSessions = await findActiveSessions(
		projectPath,
		options.sessionRoot,
	);
	if (activeSessions.length > 0)
		return failure(
			"io-error",
			"An active backup session already exists for this project; refuse concurrent execution.",
			new Error(
				activeSessions.map((session) => session.sessionDirectory).join(", "),
			),
		);
	const backup = await beginBackupSession(projectPath, options);
	if (!backup.ok) return backup;
	const patched = await patchManifest(projectPath);
	if (!patched.ok) return patched;
	const session = {
		...backup.value,
		addedPackages: patched.value,
	} satisfies BackupSession;
	try {
		await writeBackupSession(session);
		return ok(session);
	} catch (cause) {
		return failure(
			"io-error",
			"Session metadata could not be updated after manifest patch.",
			cause,
		);
	}
}
export const beginSession = beginProjectSession;

/** Find active sessions for a project without modifying either the project or session state. */
export async function findActiveSessions(
	projectPath: string,
	sessionRoot?: string,
): Promise<readonly BackupSession[]> {
	const rootResult =
		sessionRoot === undefined ? resolveSessionDirectory() : ok(sessionRoot);
	if (!rootResult.ok) return [];
	let entries: Dirent<string>[];
	try {
		entries = await readdir(rootResult.value, { withFileTypes: true });
	} catch {
		return [];
	}
	const resolvedProject = path.resolve(projectPath);
	const sessions: BackupSession[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		try {
			const session = await readBackupSession(
				path.join(rootResult.value, entry.name),
			);
			if (
				session.status === "active" &&
				path.resolve(session.projectPath) === resolvedProject
			)
				sessions.push(session);
		} catch {
			// Ignore incomplete or unrelated session directories.
		}
	}
	return sessions;
}

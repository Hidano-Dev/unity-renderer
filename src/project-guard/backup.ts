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
import {
	acquireExclusiveLock,
	releaseExclusiveLock,
} from "../shared/exclusive-lock.js";
import {
	canonicalProjectPath,
	resolveSessionDirectory,
} from "../shared/paths.js";
import { rollbackPromotionJournals } from "../shared/promotion-journal.js";
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
	/** セッションを所有する CLI プロセス。生存中は稼働中でありクラッシュ残骸ではない */
	readonly ownerPid?: number;
	/**
	 * 別名パス(junction / symlink / ドライブ文字の大小)を畳み込んだ同一性キー。
	 * セッションの突き合わせと排他はこの値で行う。
	 */
	readonly projectKey?: string;
}

/** 別名パスを同じセッションとして扱うための比較キー。 */
export async function projectIdentityKey(projectPath: string): Promise<string> {
	return canonicalProjectPath(projectPath);
}

function sessionMatchesProject(
	session: BackupSession,
	projectKey: string,
): boolean {
	// projectKey を持たない旧セッションは resolve 済みパスで突き合わせる
	return session.projectKey === undefined
		? path.resolve(session.projectPath).toLowerCase() ===
				projectKey.toLowerCase()
		: session.projectKey === projectKey;
}

export { sessionMatchesProject };
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
	readonly ownerPid?: number;
	readonly isProcessAlive?: (pid: number) => boolean;
	/** パッチ後のメタデータ書き込み。巻き戻し経路の検証用に差し替えられる */
	readonly writeSession?: (session: BackupSession) => Promise<void>;
}

function defaultIsProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (cause) {
		return (cause as NodeJS.ErrnoException).code === "EPERM";
	}
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
function projectHashOf(projectKey: string): string {
	return createHash("sha256").update(projectKey).digest("hex").slice(0, 12);
}

function sessionDirectoryName(projectKey: string, now: Date): string {
	return `${projectHashOf(projectKey)}-${now.toISOString().replace(/[-:.TZ]/g, "")}`;
}

/**
 * 生存ロックが到達し得ない老朽閾値。begin 区間(チェック + manifest バックアップ +
 * パッチ)は通常 1 秒未満で完了するため、これより古い active ロックは残骸とみなす。
 */
/**
 * findActiveSessions → beginBackupSession のチェック→作成区間を直列化する
 * 排他ロック。実装は shared/exclusive-lock を共有する。
 */
export async function acquireBeginLock(
	sessionRoot: string,
	projectKey: string,
	isAlive: (pid: number) => boolean,
): Promise<Result<string, GuardError>> {
	const acquired = await acquireExclusiveLock(
		path.join(sessionRoot, `${projectHashOf(projectKey)}.begin.lock`),
		{
			isProcessAlive: isAlive,
			heldMessage:
				"別の実行がこのプロジェクトのセッションを開始中です。同時実行はできません。",
			staleMessage:
				"直前の実行が残したセッション開始ロックを検出しました。終了処理中の可能性があるため、30 秒ほど待って再実行してください。",
		},
	);
	return acquired.ok
		? acquired
		: failure("io-error", acquired.error.message, acquired.error.cause);
}

export const releaseBeginLock = releaseExclusiveLock;
async function atomicRestore(source: string, target: string): Promise<void> {
	const temporary = `${target}.${randomUUID()}.restore.tmp`;
	try {
		await copyFile(source, temporary);
		await rename(temporary, target);
	} finally {
		await rm(temporary, { force: true });
	}
}

/**
 * バックアップから manifest 群を戻し、セッションを閉じる。recovery の
 * `restoreSession` はこれに委譲する(セッション開始失敗時の巻き戻しでも使うため、
 * backup 側に実体を置いて backup ↔ recovery の循環参照を避ける)。
 */
export async function restoreBackupSession(
	session: BackupSession,
): Promise<Result<void, GuardError>> {
	try {
		// 出力公開の途中で落ちた場合、退避された旧動画がジャーナルに記録されている。
		// セッションディレクトリを消す前に元へ戻す
		const unresolved = await rollbackPromotionJournals(
			session.sessionDirectory,
		);
		if (unresolved.length > 0)
			return err({
				kind: "restore-failed",
				message: `出力の巻き戻しに失敗しました。手動で戻してください: ${unresolved.join(", ")}`,
				manualRecoveryHint: `退避ファイルを元の名前へ戻してください: ${unresolved.join(", ")}`,
			});
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
		await writeBackupSession({ ...session, status: "restored" as const });
		await rm(session.sessionDirectory, { recursive: true, force: true });
		return ok(undefined);
	} catch (cause) {
		return err({
			kind: "restore-failed",
			message:
				"Project manifest restoration failed; the active session was retained for retry.",
			cause,
			manualRecoveryHint:
				"Keep the active session directory and retry recovery before running another render.",
		});
	}
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
	const projectKey = await projectIdentityKey(projectPath);
	const sessionDirectory = path.join(
		rootResult.value,
		sessionDirectoryName(projectKey, now()),
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
			ownerPid: options.ownerPid ?? process.pid,
			projectKey,
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
/**
 * セッション開始途中の失敗を、プロジェクトを元に戻したうえで報告する。
 * 巻き戻し自体が失敗した場合は、手動復旧の手掛かりを含む復元エラーを返す。
 */
async function rollback(
	session: BackupSession,
	original: { readonly ok: false; readonly error: GuardError },
): Promise<Result<never, GuardError>> {
	const restored = await restoreBackupSession(session);
	if (restored.ok) return original;
	return err({
		...restored.error,
		message: `${original.error.message} 巻き戻しにも失敗しました: ${restored.error.message}`,
	});
}

export async function beginProjectSession(
	projectPath: string,
	options: BackupOptions = {},
): Promise<Result<BackupSession, GuardError>> {
	const rootResult =
		options.sessionRoot === undefined
			? resolveSessionDirectory()
			: ok(options.sessionRoot);
	if (!rootResult.ok) return failure("io-error", rootResult.error.message);
	const sessionRoot = rootResult.value;
	try {
		await mkdir(sessionRoot, { recursive: true });
	} catch (cause) {
		return failure(
			"io-error",
			"セッションディレクトリを作成できませんでした。",
			cause,
		);
	}
	const isAlive = options.isProcessAlive ?? defaultIsProcessAlive;
	const lock = await acquireBeginLock(
		sessionRoot,
		await projectIdentityKey(projectPath),
		isAlive,
	);
	if (!lock.ok) return lock;
	try {
		const activeSessions = await findActiveSessions(projectPath, sessionRoot);
		if (activeSessions.length > 0)
			return failure(
				"io-error",
				"An active backup session already exists for this project; refuse concurrent execution.",
				new Error(
					activeSessions.map((session) => session.sessionDirectory).join(", "),
				),
			);
		const backup = await beginBackupSession(projectPath, {
			...options,
			sessionRoot,
		});
		if (!backup.ok) return backup;
		// パッチ以降の失敗はプロジェクトを一時変更したまま返ってしまう。バッチは
		// 開始されず復元も走らないため、この関数の中で必ず巻き戻す
		const patched = await patchManifest(projectPath);
		if (!patched.ok) return rollback(backup.value, patched);
		const session = {
			...backup.value,
			addedPackages: patched.value,
		} satisfies BackupSession;
		try {
			await (options.writeSession ?? writeBackupSession)(session);
			return ok(session);
		} catch (cause) {
			return rollback(session, {
				ok: false,
				error: {
					kind: "io-error",
					message:
						"Session metadata could not be updated after manifest patch.",
					cause,
				},
			});
		}
	} finally {
		await releaseBeginLock(lock.value);
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
	const projectKey = await projectIdentityKey(projectPath);
	const sessions: BackupSession[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		try {
			const session = await readBackupSession(
				path.join(rootResult.value, entry.name),
			);
			if (
				session.status === "active" &&
				sessionMatchesProject(session, projectKey)
			)
				sessions.push(session);
		} catch {
			// Ignore incomplete or unrelated session directories.
		}
	}
	return sessions;
}

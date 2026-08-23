import { createHash, randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import {
	access,
	copyFile,
	link,
	mkdir,
	readdir,
	readFile,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
	canonicalProjectPath,
	resolveSessionDirectory,
} from "../shared/paths.js";
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
const STALE_BEGIN_LOCK_AGE_MS = 30_000;

/**
 * findActiveSessions → beginBackupSession のチェック→作成区間を直列化する
 * 排他ロック。完全な内容を書いた一時ファイルを link(2) でアトミックに公開する
 * (link は EEXIST で失敗する排他作成)ため、公開されたロックの内容は常に完全で、
 * 「読めないロック = 書き込み途中」という誤認による生存ロックの奪取は起きない。
 *
 * 残骸の奪取は「所有プロセス死亡 かつ mtime が老朽閾値超過」の場合に限り、
 * 削除直前に mtime の不変を再確認する。生存ロックは閾値より必ず新しいため
 * 誤奪取されない。stat 再確認 → rm の間に別の奪取者と入れ替わるサブミリ秒の
 * 理論的競合窓は残る(ファイルロックの原理的限界)が、成立には「残骸の存在 +
 * 二重起動 + サブミリ秒の交錯」の重なりが必要で、運用上許容する。
 */
export async function acquireBeginLock(
	sessionRoot: string,
	projectKey: string,
	isAlive: (pid: number) => boolean,
): Promise<Result<string, GuardError>> {
	const lockPath = path.join(
		sessionRoot,
		`${projectHashOf(projectKey)}.begin.lock`,
	);
	for (let attempt = 0; attempt < 2; attempt++) {
		const temporaryPath = `${lockPath}.${process.pid}.${randomUUID()}.tmp`;
		try {
			await writeFile(temporaryPath, JSON.stringify({ pid: process.pid }));
			await link(temporaryPath, lockPath);
			return ok(lockPath);
		} catch (cause) {
			if ((cause as NodeJS.ErrnoException).code !== "EEXIST")
				return failure(
					"io-error",
					"セッション開始ロックの作成に失敗しました。",
					cause,
				);
			let observed: { mtimeMs: number } | undefined;
			try {
				observed = await stat(lockPath);
			} catch {
				continue; // 解放された直後。次の周回で取得を試みる
			}
			let lockOwnerPid: number | undefined;
			try {
				const parsed = JSON.parse(await readFile(lockPath, "utf8")) as {
					pid?: number;
				};
				lockOwnerPid = typeof parsed.pid === "number" ? parsed.pid : undefined;
			} catch {
				continue; // 解放された直後。次の周回で取得を試みる
			}
			if (lockOwnerPid !== undefined && isAlive(lockOwnerPid))
				return failure(
					"io-error",
					"別の実行がこのプロジェクトのセッションを開始中です。同時実行はできません。",
				);
			if (Date.now() - observed.mtimeMs < STALE_BEGIN_LOCK_AGE_MS)
				return failure(
					"io-error",
					"直前の実行が残したセッション開始ロックを検出しました。終了処理中の可能性があるため、30 秒ほど待って再実行してください。",
				);
			// 奪取の直前に、観測した残骸が置き換わっていないことを再確認する
			try {
				const current = await stat(lockPath);
				if (current.mtimeMs !== observed.mtimeMs) continue;
			} catch {
				continue;
			}
			await rm(lockPath, { force: true });
		} finally {
			await rm(temporaryPath, { force: true });
		}
	}
	return failure(
		"io-error",
		"セッション開始ロックを獲得できませんでした。再実行してください。",
	);
}

/**
 * 自分が所有するロックのみ解放する。所有者死亡と誤認して奪取された後に、
 * 新所有者のロックを消してしまわないための所有権確認。自プロセス生存中に
 * 奪取が起きるのは誤認経路のみで、link 公開によりその経路は閉じているが、
 * 解放側でも防衛する。
 */
export async function releaseBeginLock(lockPath: string): Promise<void> {
	try {
		const parsed = JSON.parse(await readFile(lockPath, "utf8")) as {
			pid?: number;
		};
		if (parsed.pid !== process.pid) return;
	} catch {
		return;
	}
	await rm(lockPath, { force: true });
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

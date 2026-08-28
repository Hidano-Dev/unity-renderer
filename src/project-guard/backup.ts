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
	/**
	 * 内容が記録時と同じなら復元を省く。Timeline アセットのように、正常系では
	 * 一度も書き換わらない「保険としてのバックアップ」に付ける。書き戻すと
	 * 中身が同じでも mtime が動き、Unity が次回起動時に再インポートしてしまう。
	 */
	readonly skipIfUnchanged?: boolean;
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

async function atomicRestore(source: string, target: string): Promise<void> {
	const temporary = `${target}.${randomUUID()}.restore.tmp`;
	try {
		await copyFile(source, temporary);
		await rename(temporary, target);
	} finally {
		await rm(temporary, { force: true });
	}
}

/** 対象が記録時と同一内容か。読めない場合は「変わった」として復元させる。 */
async function isUnchanged(target: string, file: BackupFile): Promise<boolean> {
	try {
		return hash(await readFile(target)) === file.sha256;
	} catch {
		return false;
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
		for (const file of session.files) {
			const target = path.join(session.projectPath, file.relativePath);
			const backup = path.join(session.sessionDirectory, file.backupFileName);
			if (file.exists) {
				if (file.skipIfUnchanged === true && (await isUnchanged(target, file)))
					continue;
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

/** プロジェクト相対パスから、セッション内で衝突しないバックアップ名を作る。 */
function backupFileNameFor(relativePath: string): string {
	const digest = createHash("sha256")
		.update(relativePath.toLowerCase())
		.digest("hex")
		.slice(0, 12);
	return `asset-${digest}${path.extname(relativePath)}`;
}

/** `Assets/...` 形式を OS のパス区切りへ正規化する。 */
function normalizeRelativePath(relativePath: string): string {
	return path.normalize(relativePath.replace(/\//gu, path.sep));
}

/**
 * 実行中のセッションへバックアップ対象を追加する。Timeline から RecorderTrack を
 * 外す前に、対象アセットをここへ預けておくと、通常の復元とクラッシュ後の
 * `recoverProject` の両方が同じ経路で書き戻せる。
 *
 * 既に登録済みのパスは読み飛ばす(Scene をまたいで同じ Timeline を共有していても、
 * 最初に記録した「変更前」の内容を上書きしないため)。
 */
export async function registerBackupFiles(
	session: BackupSession,
	relativePaths: readonly string[],
	options: {
		readonly writeSession?: (session: BackupSession) => Promise<void>;
	} = {},
): Promise<Result<BackupSession, GuardError>> {
	const known = new Set(
		session.files.map((file) => normalizeRelativePath(file.relativePath)),
	);
	const added: BackupFile[] = [];
	try {
		for (const requested of relativePaths) {
			const relativePath = normalizeRelativePath(requested);
			if (relativePath === "" || known.has(relativePath)) continue;
			const source = path.resolve(session.projectPath, relativePath);
			// Unity が返したパスをそのまま結合する。プロジェクト外を指す値は、
			// バックアップ先も復元先も想定外になるため受け付けない
			const projectRoot = path.resolve(session.projectPath);
			if (
				source !== projectRoot &&
				!source.startsWith(`${projectRoot}${path.sep}`)
			)
				throw new Error(`Path escapes the project directory: ${requested}`);
			const backupFileName = backupFileNameFor(relativePath);
			const backupPath = path.join(session.sessionDirectory, backupFileName);
			await copyFile(source, backupPath);
			const [originalBytes, backupBytes] = await Promise.all([
				readFile(source),
				readFile(backupPath),
			]);
			if (Buffer.compare(originalBytes, backupBytes) !== 0)
				throw new Error(`Backup verification failed: ${requested}`);
			known.add(relativePath);
			added.push({
				relativePath,
				backupFileName,
				sha256: hash(originalBytes),
				exists: true,
				skipIfUnchanged: true,
			});
		}
	} catch (cause) {
		return failure(
			"backup-failed",
			"Timeline アセットのバックアップに失敗しました。RecorderTrack は削除していません。",
			cause,
		);
	}
	if (added.length === 0) return ok(session);
	const updated: BackupSession = {
		...session,
		files: [...session.files, ...added],
	};
	try {
		await (options.writeSession ?? writeBackupSession)(updated);
		return ok(updated);
	} catch (cause) {
		return failure(
			"io-error",
			"バックアップ一覧を更新できませんでした。RecorderTrack は削除していません。",
			cause,
		);
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
	// 同一プロジェクトの二重実行は active セッションの有無で拒否する。単一実行を
	// 前提とするツールのため、チェックと作成の間のごく短い競合窓は許容する
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
				message: "Session metadata could not be updated after manifest patch.",
				cause,
			},
		});
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

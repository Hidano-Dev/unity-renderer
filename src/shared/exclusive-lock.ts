import { randomUUID } from "node:crypto";
import { link, readFile, rm, stat, writeFile } from "node:fs/promises";
import { err, ok, type Result } from "./types.js";

/** @impl URC-6.3 @impl URC-7.5 */

export interface LockError {
	readonly kind: "held" | "io-error";
	readonly message: string;
	readonly cause?: unknown;
}

export interface ExclusiveLockOptions {
	/** 所有プロセスの生存判定。生存中のロックは決して奪わない。 */
	readonly isProcessAlive?: (pid: number) => boolean;
	/** これより古い「死亡プロセス所有」のロックのみ残骸として回収する。 */
	readonly staleAfterMs?: number;
	readonly heldMessage?: string;
	readonly staleMessage?: string;
}

export function defaultIsProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (cause) {
		// EPERM はプロセスが存在するがシグナル送信権限が無い場合
		return (cause as NodeJS.ErrnoException).code === "EPERM";
	}
}

/**
 * プロセス間の排他ロック。完全な内容を書いた一時ファイルを link(2) でアトミックに
 * 公開する(link は EEXIST で失敗する排他作成)ため、公開済みロックの内容は常に
 * 完全で、「読めないロック = 書き込み途中」という誤認による生存ロックの奪取は
 * 起きない。
 *
 * 残骸の回収は「所有プロセス死亡 かつ mtime が老朽閾値超過」の場合に限り、削除
 * 直前に mtime の不変を再確認する。stat 再確認 → rm の間のサブミリ秒の理論的
 * 競合窓はファイルロックの原理的限界として残る(docs/setup.md に記載)。
 */
export async function acquireExclusiveLock(
	lockPath: string,
	options: ExclusiveLockOptions = {},
): Promise<Result<string, LockError>> {
	const isAlive = options.isProcessAlive ?? defaultIsProcessAlive;
	const staleAfterMs = options.staleAfterMs ?? 30_000;
	for (let attempt = 0; attempt < 2; attempt++) {
		const temporaryPath = `${lockPath}.${process.pid}.${randomUUID()}.tmp`;
		try {
			await writeFile(temporaryPath, JSON.stringify({ pid: process.pid }));
			await link(temporaryPath, lockPath);
			return ok(lockPath);
		} catch (cause) {
			if ((cause as NodeJS.ErrnoException).code !== "EEXIST")
				return err({
					kind: "io-error",
					message: `ロックファイルを作成できませんでした: ${lockPath}`,
					cause,
				});
			let observed: { mtimeMs: number };
			try {
				observed = await stat(lockPath);
			} catch {
				continue; // 解放された直後。次の周回で取得を試みる
			}
			let ownerPid: number | undefined;
			try {
				const parsed = JSON.parse(await readFile(lockPath, "utf8")) as {
					pid?: number;
				};
				ownerPid = typeof parsed.pid === "number" ? parsed.pid : undefined;
			} catch {
				continue; // 解放された直後。次の周回で取得を試みる
			}
			if (ownerPid !== undefined && isAlive(ownerPid))
				return err({
					kind: "held",
					message:
						options.heldMessage ??
						"別の実行がこのリソースを使用中です。同時実行はできません。",
				});
			if (Date.now() - observed.mtimeMs < staleAfterMs)
				return err({
					kind: "held",
					message:
						options.staleMessage ??
						"直前の実行が残したロックを検出しました。終了処理中の可能性があるため、30 秒ほど待って再実行してください。",
				});
			// 回収の直前に、観測した残骸が置き換わっていないことを再確認する
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
	return err({
		kind: "io-error",
		message: `ロックを獲得できませんでした。再実行してください: ${lockPath}`,
	});
}

/**
 * 自分が所有するロックのみ解放する。死亡と誤認されて奪取された後に、新しい
 * 所有者のロックを消してしまわないための所有権確認。
 */
export async function releaseExclusiveLock(lockPath: string): Promise<void> {
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

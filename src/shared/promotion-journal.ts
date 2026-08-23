import { randomUUID } from "node:crypto";
import {
	mkdir,
	readdir,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import path from "node:path";

/** @impl URC-10.3 @impl URC-6.4 */

/**
 * 出力公開の退避情報。公開は「既存出力を退避 → staging を最終パスへ rename」の
 * 2 手順で進むため、その間にプロセスや OS が落ちると最終パスが欠落し得る。
 * 退避先をここへ記録しておき、次回起動の復旧が旧出力を元へ戻せるようにする。
 */
export interface PromotionJournal {
	readonly displaced: readonly {
		readonly path: string;
		readonly backup: string;
	}[];
}

const JOURNAL_PREFIX = "promote-";
const JOURNAL_SUFFIX = ".json";

export function promotionJournalPath(
	sessionDirectory: string,
	sceneName: string,
): string {
	return path.join(
		sessionDirectory,
		`${JOURNAL_PREFIX}${sceneName}${JOURNAL_SUFFIX}`,
	);
}

export async function writePromotionJournal(
	journalPath: string,
	journal: PromotionJournal,
): Promise<void> {
	const temporary = `${journalPath}.${randomUUID()}.tmp`;
	await mkdir(path.dirname(journalPath), { recursive: true });
	await writeFile(temporary, JSON.stringify(journal), "utf8");
	await rename(temporary, journalPath);
}

/**
 * 中断された公開の退避物を元の場所へ戻す。戻せなかった組を返す
 * (呼び出し側が手動復旧の案内に使う)。
 */
export async function rollbackPromotionJournal(
	journalPath: string,
): Promise<readonly string[]> {
	let journal: PromotionJournal;
	try {
		journal = JSON.parse(
			await readFile(journalPath, "utf8"),
		) as PromotionJournal;
	} catch {
		return [];
	}
	const unresolved: string[] = [];
	for (const { path: target, backup } of journal.displaced ?? []) {
		try {
			await rename(backup, target);
		} catch (error) {
			// 退避ファイルが無いのは、公開完了後にジャーナルだけ残ったケース
			if ((error as NodeJS.ErrnoException).code !== "ENOENT")
				unresolved.push(`${backup} → ${target}`);
		}
	}
	// 戻せなかった退避物があるうちはジャーナルを残す。消してしまうと次回起動が
	// 退避先を辿れず、旧動画が UUID 名のまま孤立する
	if (unresolved.length === 0) await rm(journalPath, { force: true });
	return unresolved;
}

/** セッションディレクトリに残ったすべての公開ジャーナルを巻き戻す。 */
export async function rollbackPromotionJournals(
	sessionDirectory: string,
): Promise<readonly string[]> {
	let entries: string[];
	try {
		entries = await readdir(sessionDirectory);
	} catch {
		return [];
	}
	const unresolved: string[] = [];
	for (const entry of entries) {
		if (!entry.startsWith(JOURNAL_PREFIX) || !entry.endsWith(JOURNAL_SUFFIX))
			continue;
		unresolved.push(
			...(await rollbackPromotionJournal(path.join(sessionDirectory, entry))),
		);
	}
	return unresolved;
}

import {
	listSceneFiles,
	type SceneFile,
} from "../project-guard/scene-resolver.js";

/**
 * GUI の一覧に出す Scene 1 行分。
 *
 * 設定ファイルの `scenes` は Scene 名で指定する仕様なので、同名の `.unity` が
 * 複数フォルダにあると `resolveScenes` が `scenes-ambiguous` で失敗する。
 * 選ばせてから Editor 起動前に失敗させるより、一覧の時点で選べないことと
 * その理由を見せたほうがよいので、名前でまとめて候補パスを全部持たせる。
 */
export interface GuiSceneEntry {
	readonly sceneName: string;
	/** 同名 Scene が複数ある場合はすべて。プロジェクト相対・`/` 区切り。 */
	readonly assetPaths: readonly string[];
	/** 同名 Scene が 1 つだけのときに限り選択できる。 */
	readonly selectable: boolean;
}

export function groupSceneFiles(
	files: readonly SceneFile[],
): readonly GuiSceneEntry[] {
	const byName = new Map<string, string[]>();
	for (const file of files) {
		const paths = byName.get(file.sceneName);
		if (paths) paths.push(file.assetPath);
		else byName.set(file.sceneName, [file.assetPath]);
	}

	return [...byName.entries()]
		.map(([sceneName, assetPaths]) => ({
			sceneName,
			assetPaths: [...assetPaths].sort(),
			selectable: assetPaths.length === 1,
		}))
		.sort((left, right) => left.sceneName.localeCompare(right.sceneName, "ja"));
}

export async function listGuiScenes(
	projectPath: string,
): Promise<readonly GuiSceneEntry[]> {
	return groupSceneFiles(await listSceneFiles(projectPath));
}

/**
 * 選択済み Scene 名から、実際に書き出せるものだけを一覧順で残す。
 * 前回保存した選択に、消えた Scene や同名になった Scene が混じっていても
 * そのまま設定へ持ち込まないための絞り込み。
 */
export function selectableSelection(
	entries: readonly GuiSceneEntry[],
	selected: readonly string[],
): readonly string[] {
	const wanted = new Set(selected);
	return entries
		.filter((entry) => entry.selectable && wanted.has(entry.sceneName))
		.map((entry) => entry.sceneName);
}

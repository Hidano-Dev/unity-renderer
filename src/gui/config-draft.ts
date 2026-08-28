import { writeFile } from "node:fs/promises";
import { type RenderConfig, validateRenderConfig } from "../config/schema.js";
import { err, ok, type Result } from "../shared/types.js";
import type { GuiState } from "./state.js";

export interface ConfigDraftIssue {
	readonly path: string;
	readonly message: string;
}

/**
 * 空欄は zod へ渡す前に日本語で返す。スキーマ側の "must not be empty" は
 * 英語かつ項目パス表記なので、GUI の利用者にそのまま見せる文面ではない。
 */
function missingFieldIssues(
	state: GuiState,
	selectedScenes: readonly string[],
): readonly ConfigDraftIssue[] {
	const issues: ConfigDraftIssue[] = [];
	if (state.projectPath.trim() === "")
		issues.push({
			path: "projectPath",
			message: "Unity プロジェクトのフォルダを指定してください",
		});
	if (selectedScenes.length === 0)
		issues.push({
			path: "scenes",
			message: "書き出す Scene を 1 つ以上選択してください",
		});
	if (state.outputDirectory.trim() === "")
		issues.push({
			path: "output.directory",
			message: "出力先フォルダを指定してください",
		});
	return issues;
}

/**
 * GUI の入力から実行用の設定を組み立て、CLI と同じスキーマで検証する。
 * GUI 専用の緩い検証を別に持つと、GUI では通るのに `render` で落ちる設定が
 * 作れてしまうため、判定は必ず `validateRenderConfig` に通す。
 */
export function buildRenderConfigDraft(
	state: GuiState,
	selectedScenes: readonly string[],
): Result<RenderConfig, readonly ConfigDraftIssue[]> {
	const missing = missingFieldIssues(state, selectedScenes);
	if (missing.length > 0) return err(missing);

	const validated = validateRenderConfig({
		projectPath: state.projectPath,
		scenes: [...selectedScenes],
		resolution: {
			width: state.resolution.width,
			height: state.resolution.height,
		},
		frameRate: state.frameRate,
		formats: [...state.formats],
		output: {
			directory: state.outputDirectory,
			fileName: state.fileName,
		},
		debug: false,
	});
	if (!validated.ok)
		return err(
			validated.error.issues.map((issue) => ({
				path: issue.path,
				message: issue.message,
			})),
		);
	return ok(validated.value);
}

export async function writeRenderConfigFile(
	configPath: string,
	config: RenderConfig,
): Promise<void> {
	await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

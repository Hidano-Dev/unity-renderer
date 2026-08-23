import path from "node:path";
import { loadConfig } from "../config/load.js";
import { recoverProject as recoverProjectDefault } from "../project-guard/recovery.js";
import { resolveScenes as resolveScenesDefault } from "../project-guard/scene-resolver.js";
import {
	type EditorInstall,
	listEditors as listEditorsDefault,
} from "../unity-env/editors.js";
import { readProjectVersion as readProjectVersionDefault } from "../unity-env/project-version.js";
import { detectUnityCli as detectUnityCliDefault } from "../unity-env/unity-cli.js";

/** @impl URC-15.2 */
export interface CheckCommandDependencies {
	readonly detectUnityCli?: typeof detectUnityCliDefault;
	readonly readProjectVersion?: typeof readProjectVersionDefault;
	readonly listEditors?: typeof listEditorsDefault;
	readonly resolveScenes?: typeof resolveScenesDefault;
	readonly recoverProject?: typeof recoverProjectDefault;
	readonly write?: (message: string) => void;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function sceneErrorMessage(error: {
	readonly details: readonly {
		readonly sceneName: string;
		readonly candidatePaths: readonly string[];
	}[];
}): string {
	return error.details
		.map(
			(detail) =>
				`${detail.sceneName}: ${detail.candidatePaths.join(", ") || "not found"}`,
		)
		.join("; ");
}

/**
 * Run the non-mutating preflight checks. The Editor is never started.
 * 唯一の例外としてクラッシュ復旧だけは実行する(design: project-guard 契約 6.4。
 * ユーザーの原状回復を最優先するため、check の「プロジェクト無変更」原則の例外)。
 */
export async function runCheck(
	configPath: string,
	dependencies: CheckCommandDependencies = {},
): Promise<0 | 1> {
	const write =
		dependencies.write ??
		((message: string) => process.stderr.write(`${message}\n`));
	try {
		const loaded = await loadConfig(configPath);
		if (!loaded.ok) {
			write(
				`Error: ${loaded.error.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`,
			);
			return 1;
		}
		const config = loaded.value;
		const projectPath = path.resolve(config.projectPath);
		const recovered = await (
			dependencies.recoverProject ?? recoverProjectDefault
		)(projectPath);
		if (!recovered.ok) {
			write(`Error: ${recovered.error.message}`);
			return 1;
		}
		if (recovered.value.length > 0)
			write(
				`前回実行の未復元セッションを検出し、manifest を復元しました (${recovered.value.length} 件)`,
			);
		const cli = await (dependencies.detectUnityCli ?? detectUnityCliDefault)();
		if (!cli.ok) {
			write(`Error: ${cli.error.message}`);
			return 1;
		}
		const version = await (
			dependencies.readProjectVersion ?? readProjectVersionDefault
		)(projectPath);
		if (!version.ok) {
			write(`Error: ${version.error.message}`);
			return 1;
		}
		const editors = await (dependencies.listEditors ?? listEditorsDefault)();
		if (!editors.ok) {
			write(`Error: ${editors.error.message}`);
			return 1;
		}
		const editor = editors.value.find(
			(candidate: EditorInstall) => candidate.version.raw === version.value.raw,
		);
		if (!editor) {
			write(
				`Error: Unity Editor ${version.value.raw} is not installed. Run unity install or install the matching Editor.`,
			);
			return 1;
		}
		const scenes = await (dependencies.resolveScenes ?? resolveScenesDefault)(
			projectPath,
			config.scenes,
		);
		if (!scenes.ok) {
			write(
				`Error: Scene resolution failed: ${sceneErrorMessage(scenes.error)}`,
			);
			return 1;
		}
		write(
			`Check passed: Unity CLI ${cli.value.cliVersion}, Editor ${editor.version.raw}, ${scenes.value.length} scene(s).`,
		);
		return 0;
	} catch (cause) {
		write(`Error: ${errorMessage(cause)}`);
		return 1;
	}
}

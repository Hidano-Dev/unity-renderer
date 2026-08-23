import path from "node:path";
import { type BatchRunner, createBatchRunner } from "../batch/runner.js";
import { loadConfig } from "../config/load.js";
import {
	type BackupSession,
	beginProjectSession,
	type GuardError,
} from "../project-guard/backup.js";
import { checkProjectLock } from "../project-guard/lock.js";
import { recoverProject } from "../project-guard/recovery.js";
import {
	type ResolvedScene,
	resolveScenes,
} from "../project-guard/scene-resolver.js";
import { toExitCode } from "../reporting/exit-code.js";
import { createProgressReporter } from "../reporting/progress.js";
import type { Result } from "../shared/types.js";
import type { EditorInstall, listEditors } from "../unity-env/editors.js";
import { ensureEditor } from "../unity-env/install.js";
import { readProjectVersion } from "../unity-env/project-version.js";
import { detectUnityCli } from "../unity-env/unity-cli.js";

/** @impl URC-6.4 @impl URC-13.4 @impl URC-13.5 @impl URC-15.1 */

type PreflightError = { readonly message: string };

export interface RenderCommandDependencies {
	readonly detectUnityCli?: typeof detectUnityCli;
	readonly readProjectVersion?: typeof readProjectVersion;
	readonly listEditors?: typeof listEditors;
	readonly ensureEditor?: typeof ensureEditor;
	readonly interactive?: boolean;
	readonly resolveScenes?: typeof resolveScenes;
	readonly checkProjectLock?: typeof checkProjectLock;
	readonly recoverProject?: typeof recoverProject;
	readonly beginSession?: (
		projectPath: string,
	) => Promise<Result<BackupSession, GuardError>>;
	readonly batchRunner?: BatchRunner;
	readonly write?: (message: string) => void;
	readonly isTTY?: boolean;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function fail(message: string, write: (message: string) => void): 1 {
	write(`Error: ${message}`);
	return 1;
}

async function preflight(
	configPath: string,
	dependencies: RenderCommandDependencies,
): Promise<
	Result<
		{
			config: Awaited<ReturnType<typeof loadConfig>> extends Result<
				infer T,
				unknown
			>
				? T
				: never;
			editor: EditorInstall;
			scenes: readonly ResolvedScene[];
		},
		PreflightError
	>
> {
	const loaded = await loadConfig(configPath);
	if (!loaded.ok)
		return {
			ok: false,
			error: {
				message: loaded.error.issues
					.map((issue) => `${issue.path}: ${issue.message}`)
					.join("; "),
			},
		};
	const config = loaded.value;
	const projectPath = path.resolve(config.projectPath);
	const recover = await (dependencies.recoverProject ?? recoverProject)(
		projectPath,
	);
	if (!recover.ok)
		return { ok: false, error: { message: recover.error.message } };
	if (recover.value.length > 0)
		dependencies.write?.(
			`前回実行の未復元セッションを検出し、manifest を復元しました (${recover.value.length} 件)`,
		);
	const cli = await (dependencies.detectUnityCli ?? detectUnityCli)();
	if (!cli.ok) return { ok: false, error: { message: cli.error.message } };
	const version = await (dependencies.readProjectVersion ?? readProjectVersion)(
		projectPath,
	);
	if (!version.ok)
		return { ok: false, error: { message: version.error.message } };
	// 一致 Editor の解決は install フロー(4.3-4.5)へ委譲する: 不一致時は対話モード
	// でのみ unity install を確認し、非対話・辞退・失敗ではプロジェクト非変更で中断
	const ensured = await (dependencies.ensureEditor ?? ensureEditor)(
		version.value,
		dependencies.interactive ?? process.stdin.isTTY === true,
		{ listEditors: dependencies.listEditors },
	);
	if (!ensured.ok)
		return { ok: false, error: { message: ensured.error.message } };
	const editor = ensured.value;
	const scenes = await (dependencies.resolveScenes ?? resolveScenes)(
		projectPath,
		config.scenes,
	);
	if (!scenes.ok) {
		const details = scenes.error.details
			.map(
				(detail) =>
					`${detail.sceneName}: ${detail.candidatePaths.join(", ") || "not found"}`,
			)
			.join("; ");
		return {
			ok: false,
			error: { message: `Scene resolution failed: ${details}` },
		};
	}
	const lock = await (dependencies.checkProjectLock ?? checkProjectLock)(
		projectPath,
	);
	if (!lock.ok) return { ok: false, error: { message: lock.error.message } };
	return {
		ok: true,
		value: { config: { ...config, projectPath }, editor, scenes: scenes.value },
	};
}

export async function runRender(
	configPath: string,
	dependencies: RenderCommandDependencies = {},
): Promise<0 | 1 | 2 | 3> {
	const write =
		dependencies.write ??
		((message: string) => process.stderr.write(`${message}\n`));
	let plan: Awaited<ReturnType<typeof preflight>>;
	try {
		plan = await preflight(configPath, { ...dependencies, write });
	} catch (cause) {
		return fail(messageOf(cause), write);
	}
	if (!plan.ok) return fail(plan.error.message, write);

	const sessionResult = await (
		dependencies.beginSession ?? beginProjectSession
	)(plan.value.config.projectPath);
	if (!sessionResult.ok) return fail(sessionResult.error.message, write);
	const reporter = createProgressReporter({
		debug: plan.value.config.debug,
		isTTY: dependencies.isTTY,
		write,
	});
	try {
		const batch = await (dependencies.batchRunner ?? createBatchRunner()).run(
			{ ...plan.value, session: sessionResult.value },
			undefined,
			reporter,
		);
		return toExitCode(batch);
	} catch (cause) {
		write(`Error: ${messageOf(cause)}`);
		return 3;
	}
}

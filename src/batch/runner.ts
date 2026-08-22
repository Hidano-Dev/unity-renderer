import type { RenderConfig } from "../config/schema.js";
import type { PipelineClient } from "../editor-session/pipeline-client.js";
import { createPipelineClient } from "../editor-session/pipeline-client.js";
import {
	createEditorSession,
	type EditorSession,
} from "../editor-session/session.js";
import type { RenderHooks } from "../hooks/registry.js";
import type { BackupSession, GuardError } from "../project-guard/backup.js";
import { restoreSession } from "../project-guard/recovery.js";
import type { ResolvedScene } from "../project-guard/scene-resolver.js";
import type { ProgressReporter } from "../reporting/progress.js";
import type { Result } from "../shared/types.js";
import type { EditorInstall } from "../unity-env/editors.js";
import {
	createSceneJob,
	type SceneJob,
	type SceneJobDependencies,
	type SceneJobPlan,
	type SceneResult,
} from "./scene-job.js";

/** @impl URC-6.3 @impl URC-10.5 @impl URC-12.1 @impl URC-12.2 @impl URC-12.3 @impl URC-12.4 */

export interface BatchPlan {
	readonly config: RenderConfig;
	readonly editor: EditorInstall;
	readonly scenes: readonly ResolvedScene[];
	readonly session: BackupSession;
}

export interface BatchResult {
	readonly scenes: readonly SceneResult[];
	readonly restoreSucceeded: boolean;
}

export interface BatchRunnerDependencies {
	readonly createSession?: () => EditorSession;
	readonly createPipeline?: (
		projectPath: string,
		sessionDir: string,
	) => PipelineClient;
	readonly createSceneJob?: (dependencies: SceneJobDependencies) => SceneJob;
	readonly restore?: (
		session: BackupSession,
	) => Promise<Result<void, GuardError>>;
}

export interface BatchRunner {
	run(
		plan: BatchPlan,
		hooks?: RenderHooks,
		reporter?: ProgressReporter,
	): Promise<BatchResult>;
}

function unexpectedSceneFailure(
	scene: ResolvedScene,
	cause: unknown,
): SceneResult {
	return {
		sceneName: scene.sceneName,
		outcome: "failure",
		failureReason: "recording-failed",
		warnings: [],
		outputs: [],
		durationSec: 0,
		error: cause instanceof Error ? cause.message : String(cause),
	};
}

export function createBatchRunner(
	dependencies: BatchRunnerDependencies = {},
): BatchRunner {
	const createSession =
		dependencies.createSession ?? (() => createEditorSession());
	const createPipeline =
		dependencies.createPipeline ??
		((projectPath, sessionDir) =>
			createPipelineClient({ projectPath, sessionDir }));
	const createJob = dependencies.createSceneJob ?? createSceneJob;
	const restore = dependencies.restore ?? restoreSession;

	return {
		async run(plan, hooks, reporter) {
			const results: SceneResult[] = [];
			let restoreSucceeded = false;

			try {
				for (const [index, scene] of plan.scenes.entries()) {
					reporter?.sceneStarted(scene.sceneName, index, plan.scenes.length);
					const session = createSession();
					const pipeline = createPipeline(
						plan.config.projectPath,
						plan.session.sessionDirectory,
					);
					const hookRunner = hooks?.afterRecording
						? async (
								context: Parameters<
									NonNullable<RenderHooks["afterRecording"]>
								>[0],
							) => {
								try {
									await hooks.afterRecording?.(context);
									return { ok: true as const, value: undefined };
								} catch (cause) {
									return {
										ok: false as const,
										error: {
											message:
												cause instanceof Error ? cause.message : String(cause),
										},
									};
								}
							}
						: undefined;
					const job = createJob({
						session,
						pipeline,
						hooks,
						runHooks: hookRunner,
					});
					const jobPlan: SceneJobPlan = {
						config: plan.config,
						editor: plan.editor,
						scene,
						sessionDir: plan.session.sessionDirectory,
					};

					let result: SceneResult;
					try {
						result = await job.run(jobPlan);
					} catch (cause) {
						await session
							.quit(plan.config.timeouts?.editorQuitSec ?? 60)
							.catch(() => session.kill());
						result = unexpectedSceneFailure(scene, cause);
					}
					results.push(result);
					reporter?.sceneFinished(result);
				}
			} finally {
				// Package modifications are owned by the batch session. Restore only once,
				// after every queued Scene has had a chance to run.
				const restored = await restore(plan.session);
				restoreSucceeded = restored.ok;
				reporter?.batchSummary({ scenes: results, restoreSucceeded });
				if (!restored.ok)
					reporter?.warn(
						`Project restoration failed: ${restored.error.message}`,
					);
			}
			return { scenes: results, restoreSucceeded };
		},
	};
}

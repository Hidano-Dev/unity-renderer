import { join } from "node:path";
import { resolveRecordingTimeoutSec } from "../config/load.js";
import type { OutputFormat, RenderConfig } from "../config/schema.js";
import {
	compilePayload,
	type PayloadCompiler,
} from "../csharp-payloads/compile.js";
import type {
	EvalResult,
	PipelineClient,
} from "../editor-session/pipeline-client.js";
import type { EditorSession } from "../editor-session/session.js";
import {
	createStatusChannel,
	type StatusChannel,
} from "../editor-session/status-channel.js";
import type { RenderHandoff, RenderHooks } from "../hooks/registry.js";
import type { Result } from "../shared/types.js";
import type { EditorInstall } from "../unity-env/editors.js";
import {
	cleanupOutputFiles,
	type PlannedOutput,
	planOutputs,
	validateOutputFiles,
} from "./output.js";

export type SceneFailureReason =
	| "connect-timeout"
	| "scene-open-failed"
	| "no-playable-director"
	| "recorder-setup-failed"
	| "recording-failed"
	| "recording-timeout"
	| "output-missing"
	| "hook-failed";

export interface SceneResult {
	readonly sceneName: string;
	readonly outcome: "success" | "failure";
	readonly failureReason?: SceneFailureReason;
	readonly warnings: readonly string[];
	readonly outputs: readonly {
		readonly format: OutputFormat;
		readonly videoPath: string;
	}[];
	readonly durationSec: number;
	readonly error?: string;
}

export interface SceneJobPlan {
	readonly config: RenderConfig;
	readonly editor: EditorInstall;
	readonly scene: { readonly sceneName: string; readonly assetPath: string };
	readonly sessionDir: string;
}

export interface SceneJobDependencies {
	readonly session: EditorSession;
	readonly pipeline: PipelineClient;
	readonly compiler?: PayloadCompiler;
	readonly statusChannel?: (path: string) => StatusChannel;
	readonly hooks?: RenderHooks;
	readonly hookRegistry?: {
		runAfterRecording(
			context: Parameters<NonNullable<RenderHooks["afterRecording"]>>[0],
		): Promise<Result<void, { readonly message: string }>>;
	};
	readonly runHooks?: (
		context: Parameters<NonNullable<RenderHooks["afterRecording"]>>[0],
	) => Promise<Result<void, { readonly message: string }>>;
	readonly cleanup?: (
		paths: readonly string[],
		debug: boolean,
	) => Promise<void>;
	readonly validate?: (paths: readonly string[]) => Promise<readonly string[]>;
	readonly planOutputs?: typeof planOutputs;
	readonly logger?: {
		warn(message: string): void;
		debug(message: string): void;
	};
	readonly now?: () => number;
	readonly sleep?: (milliseconds: number) => Promise<void>;
}

/** Play Mode 遷移完了待ちで start-recording を再送する間隔 */
const PLAY_MODE_RETRY_INTERVAL_MS = 2_000;

export interface SceneJob {
	run(plan: SceneJobPlan): Promise<SceneResult>;
}

interface OpenSceneResponse {
	directorFound: boolean;
	multipleDirectorsWarning: boolean;
	directorName: string | null;
	timelineDurationSec: number | null;
	timelineFrameRate: number | null;
}

function payloadResponse(value: string): unknown {
	try {
		return JSON.parse(value) as unknown;
	} catch {
		throw new Error("Unity payload returned invalid JSON");
	}
}

function asOpenScene(value: string): OpenSceneResponse {
	const parsed = payloadResponse(value);
	if (!parsed || typeof parsed !== "object")
		throw new Error("Invalid open-scene response");
	const response = parsed as Partial<OpenSceneResponse>;
	if (typeof response.directorFound !== "boolean")
		throw new Error("Invalid open-scene response");
	return {
		directorFound: response.directorFound,
		multipleDirectorsWarning: response.multipleDirectorsWarning === true,
		directorName:
			typeof response.directorName === "string" ? response.directorName : null,
		timelineDurationSec:
			typeof response.timelineDurationSec === "number"
				? response.timelineDurationSec
				: null,
		timelineFrameRate:
			typeof response.timelineFrameRate === "number"
				? response.timelineFrameRate
				: null,
	};
}

function failure(
	plan: SceneJobPlan,
	reason: SceneFailureReason,
	warnings: readonly string[],
	startedAt: number,
	error: unknown,
	outputs: readonly {
		readonly format: OutputFormat;
		readonly videoPath: string;
	}[] = [],
): SceneResult {
	return {
		sceneName: plan.scene.sceneName,
		outcome: "failure",
		failureReason: reason,
		warnings,
		outputs,
		durationSec: Math.max(0, (Date.now() - startedAt) / 1000),
		error: error instanceof Error ? error.message : String(error),
	};
}

export function createSceneJob(dependencies: SceneJobDependencies): SceneJob {
	const compiler = dependencies.compiler ?? { compile: compilePayload };
	const makeStatusChannel =
		dependencies.statusChannel ?? ((path) => createStatusChannel(path));
	const cleanup = dependencies.cleanup ?? cleanupOutputFiles;
	const validate = dependencies.validate ?? validateOutputFiles;
	const logger = dependencies.logger ?? {
		warn: () => undefined,
		debug: () => undefined,
	};
	const sleep =
		dependencies.sleep ??
		((milliseconds: number) =>
			new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));

	return {
		async run(plan) {
			const startedAt = dependencies.now?.() ?? Date.now();
			const warnings: string[] = [];
			let outputs: PlannedOutput[] = [];
			let connected = false;
			let reason: SceneFailureReason | undefined;
			let error: unknown;
			try {
				const started = await dependencies.session.start(
					plan.editor,
					plan.config.projectPath,
					plan.config.timeouts?.editorStartSec ?? 600,
				);
				if (!started.ok) {
					reason =
						started.error.kind === "connect-timeout"
							? "connect-timeout"
							: "scene-open-failed";
					error = started.error.message;
					return failure(plan, reason, warnings, startedAt, error);
				}
				connected = true;

				const open = await dependencies.pipeline.eval(
					compiler.compile("open-scene", { scenePath: plan.scene.assetPath }),
					{
						transport: { kind: "file" },
						timeoutSec: plan.config.timeouts?.editorStartSec ?? 600,
					},
				);
				if (!open.ok)
					throw Object.assign(new Error(open.error.message), {
						failureReason: "scene-open-failed" as const,
					});
				const scene = asOpenScene(open.value.returnValue);
				if (!scene.directorFound || !scene.directorName)
					throw Object.assign(new Error("PlayableDirector was not found"), {
						failureReason: "no-playable-director" as const,
					});
				if (scene.multipleDirectorsWarning)
					warnings.push(
						"Multiple root PlayableDirector components found; the first was selected.",
					);
				const duration = scene.timelineDurationSec;
				const inPoint = plan.config.range?.inPoint ?? 0;
				const outPoint = plan.config.range?.outPoint ?? duration;
				if (duration === null || outPoint === null || outPoint <= inPoint)
					throw Object.assign(new Error("Timeline duration is unavailable"), {
						failureReason: "scene-open-failed" as const,
					});

				outputs = await (dependencies.planOutputs ?? planOutputs)({
					directory: plan.config.output.directory,
					fileName: plan.config.output.fileName,
					formats: plan.config.formats,
					context: {
						project: plan.config.projectPath.split(/[\\/]/u).pop() ?? "Project",
						scene: plan.scene.sceneName,
						resolution: plan.config.resolution,
						frameRate: plan.config.frameRate,
					},
				});
				const statusPath = join(
					plan.sessionDir,
					`scene-${plan.scene.sceneName}.status.json`,
				);
				const operationId = `${plan.scene.sceneName}-${startedAt}`;
				// 前回実行の古い status ファイルは setup-recorder が "preparing" を
				// 書き込む前に削除する必要があるため、チャネルはここで生成する
				const channel = makeStatusChannel(statusPath);
				// ステージ 1: Director 検証 + preparing status + Play Mode 突入要求。
				// Recorder 構成はドメインリロードで消えるため Play Mode 内で構築する(P-7)
				const setup = await dependencies.pipeline.eval(
					compiler.compile("setup-recorder", {
						statusPath,
						operationId,
						directorName: scene.directorName,
					}),
					{
						transport: { kind: "file" },
						timeoutSec: plan.config.timeouts?.editorStartSec ?? 600,
					},
				);
				if (!setup.ok)
					throw Object.assign(new Error(setup.error.message), {
						failureReason: "recorder-setup-failed" as const,
					});
				// ステージ 2: Play Mode 遷移完了までリトライしつつ Recorder 構成 + 録画開始。
				// PLAY_MODE_NOT_READY とトランスポート断(リロード中)のみ再送する
				const stage2TimeoutSec = plan.config.timeouts?.editorStartSec ?? 600;
				const stage2Deadline =
					(dependencies.now?.() ?? Date.now()) + stage2TimeoutSec * 1_000;
				let recording: EvalResult;
				for (;;) {
					recording = await dependencies.pipeline.eval(
						compiler.compile("start-recording", {
							statusPath,
							operationId,
							directorName: scene.directorName,
							outputs: outputs.map(({ format, path }) => ({
								format,
								absolutePath: path,
							})),
							width: plan.config.resolution.width,
							height: plan.config.resolution.height,
							frameRate: plan.config.frameRate,
							inPoint,
							outPoint,
						}),
						{
							transport: { kind: "file" },
							timeoutSec: stage2TimeoutSec,
						},
					);
					if (recording.ok) break;
					const retriable =
						recording.error.kind === "eval-transport-failed" ||
						recording.error.message.includes("PLAY_MODE_NOT_READY");
					if (
						!retriable ||
						(dependencies.now?.() ?? Date.now()) >= stage2Deadline
					)
						throw Object.assign(new Error(recording.error.message), {
							failureReason: "recording-failed" as const,
						});
					await sleep(PLAY_MODE_RETRY_INTERVAL_MS);
				}
				const status = await channel.poll(
					250,
					resolveRecordingTimeoutSec(plan.config, outPoint - inPoint),
				);
				if (!status.ok)
					throw Object.assign(new Error(status.error.message), {
						failureReason: "recording-timeout" as const,
					});
				if (status.value.state === "failed")
					throw Object.assign(new Error(status.value.reason), {
						failureReason: "recording-failed" as const,
					});
				await validate(outputs.map((output) => output.path));
				const handoff: RenderHandoff = {
					sceneName: plan.scene.sceneName,
					videoPath: outputs[0]?.path ?? "",
					additionalOutputs: outputs
						.slice(1)
						.map(({ format, path }) => ({ format, videoPath: path })),
					effectiveFrameRate: plan.config.frameRate,
					inPoint,
					outPoint,
				};
				const runHooks =
					dependencies.runHooks ?? dependencies.hookRegistry?.runAfterRecording;
				if (runHooks) {
					const hookResult = await runHooks({
						handoff,
						debug: plan.config.debug ?? false,
						sessionDir: plan.sessionDir,
						evalCSharp: (source, timeoutSec) =>
							dependencies.pipeline.eval(
								{ id: "quit-editor", source },
								{ transport: { kind: "file" }, timeoutSec },
							),
						logger: { warn: logger.warn, debug: logger.debug },
					});
					if (!hookResult.ok)
						throw Object.assign(new Error(hookResult.error.message), {
							failureReason: "hook-failed" as const,
						});
				}
				return {
					sceneName: plan.scene.sceneName,
					outcome: "success",
					warnings,
					outputs: outputs.map(({ format, path }) => ({
						format,
						videoPath: path,
					})),
					durationSec: Math.max(
						0,
						((dependencies.now?.() ?? Date.now()) - startedAt) / 1000,
					),
				};
			} catch (cause) {
				reason =
					(cause as { failureReason?: SceneFailureReason }).failureReason ??
					reason ??
					"recording-failed";
				error = cause;
				await cleanup(
					outputs.map(({ path }) => path),
					plan.config.debug ?? false,
				).catch((cleanupError) => logger.warn(String(cleanupError)));
				return failure(
					plan,
					reason,
					warnings,
					startedAt,
					error,
					outputs.map(({ format, path }) => ({ format, videoPath: path })),
				);
			} finally {
				if (connected)
					await dependencies.session.quit(
						plan.config.timeouts?.editorQuitSec ?? 60,
					);
			}
		},
	};
}

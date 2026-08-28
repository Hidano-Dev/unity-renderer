import { basename, dirname, join, parse } from "node:path";
import type { HookContext, RenderHooks } from "../hooks/registry.js";
import {
	createExtractService,
	type ExtractService,
} from "./extract/run-extract.js";
import {
	createFfmpegAcquireManager,
	type FfmpegAcquireError,
	type FfmpegBinary,
} from "./ffmpeg/acquire.js";
import { buildFilterGraph } from "./ffmpeg/filter-graph.js";
import {
	type SourceDurationResolver,
	sourceDurationResolver,
} from "./ffmpeg/probe.js";
import { DefaultMuxRunner, type MuxRunner } from "./ffmpeg/run.js";
import {
	audioMetadataFileName,
	loadAudioTimelineMetadata,
} from "./metadata/load.js";
import type { AudioTimelineMetadata } from "./metadata/schema.js";
import {
	DefaultOutputFinalizer,
	type OutputFinalizer,
} from "./output/finalize.js";
import { buildMixPlan, type MixPlanner } from "./planner/mix-plan.js";
import { AudioRemuxHookError, type OutputMuxStatus } from "./types.js";

export interface MetadataLoader {
	loadAndValidate(path: string): ReturnType<typeof loadAudioTimelineMetadata>;
}

export interface FfmpegProvider {
	ensureFfmpeg(): Promise<
		| { readonly ok: true; readonly value: FfmpegBinary }
		| { readonly ok: false; readonly error: FfmpegAcquireError }
	>;
}

export interface AudioRemuxDeps {
	readonly extractor: ExtractService;
	readonly metadataLoader: MetadataLoader;
	readonly planner: MixPlanner;
	readonly ffmpegProvider: FfmpegProvider;
	readonly durationResolver: SourceDurationResolver;
	readonly muxRunner: MuxRunner;
	readonly finalizer: OutputFinalizer;
}

const defaultDeps: AudioRemuxDeps = {
	extractor: createExtractService(),
	metadataLoader: {
		loadAndValidate: (path) =>
			loadAudioTimelineMetadata(dirname(path), basename(path)),
	},
	planner: { buildMixPlan },
	ffmpegProvider: createFfmpegAcquireManager(),
	durationResolver: sourceDurationResolver,
	muxRunner: new DefaultMuxRunner(),
	finalizer: new DefaultOutputFinalizer(),
};

function detail(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "object" && error !== null) {
		if ("message" in error) return String(error.message);
		if ("stderrTail" in error) return String(error.stderrTail);
		// Metadata failures carry { kind, issues: [{ path, message }] } and have no
		// `message`. Without this branch they stringify to "[object Object]" and the
		// user never learns which clip or source file was at fault (10.1).
		const record = error as { kind?: unknown; issues?: unknown };
		if (Array.isArray(record.issues) && record.issues.length > 0) {
			const issues = record.issues
				.map((entry) => {
					const { path, message } = entry as {
						path?: unknown;
						message?: unknown;
					};
					return path ? `${String(path)}: ${String(message)}` : String(message);
				})
				.join("; ");
			return record.kind ? `${String(record.kind)} (${issues})` : issues;
		}
		if (record.kind !== undefined) return String(record.kind);
		try {
			return JSON.stringify(error);
		} catch {
			return String(error);
		}
	}
	return String(error);
}

function outputsFor(ctx: HookContext): OutputMuxStatus[] {
	return [
		{
			format: ctx.handoff.videoFormat,
			videoPath: ctx.handoff.videoPath,
			outcome: "skipped",
		},
		...ctx.handoff.additionalOutputs.map((output) => ({
			format: output.format,
			videoPath: output.videoPath,
			outcome: "skipped" as const,
		})),
	];
}

function throwFailure(
	ctx: HookContext,
	category: AudioRemuxHookError["category"],
	message: string,
	outputs: readonly OutputMuxStatus[],
): never {
	throw new AudioRemuxHookError({
		category,
		sceneName: ctx.handoff.sceneName,
		message,
		preservedVideoPaths: outputs.map((output) => output.videoPath),
		outputs,
	});
}

/**
 * 音源長を ffprobe の実デコード長で上書きする。ffprobe が使えない場合
 * （manual 配置で ffmpeg.exe だけを置いた構成）は Unity の申告値のまま進め、
 * 警告だけを出す。合成そのものは成立するため、ここで失敗にはしない。
 */
async function withProbedDurations(
	ctx: HookContext,
	metadata: AudioTimelineMetadata,
	audible: readonly AudioTimelineMetadata["clips"][number][],
	ffprobePath: string | undefined,
	resolver: SourceDurationResolver,
): Promise<AudioTimelineMetadata> {
	if (!ffprobePath) {
		ctx.logger.warn(
			"[audio-remux] ffprobe not found next to ffmpeg; falling back to Unity-reported source lengths (lossy sources may be clamped inaccurately)",
		);
		return metadata;
	}

	const { durations, unresolved } = await resolver.resolveDurations(
		ffprobePath,
		audible.map((clip) => clip.sourcePath),
	);
	for (const entry of unresolved) {
		ctx.logger.warn(
			`[audio-remux] ffprobe could not read ${entry.sourcePath}; using the Unity-reported length (${entry.reason})`,
		);
	}
	if (durations.size === 0) return metadata;

	return {
		...metadata,
		clips: metadata.clips.map((clip) => {
			const probed = durations.get(clip.sourcePath);
			if (probed === undefined || probed === clip.sourceDurationSec)
				return clip;
			ctx.logger.debug(
				`[audio-remux] source length ${clip.sourcePath}: unity=${clip.sourceDurationSec} ffprobe=${probed}`,
			);
			return { ...clip, sourceDurationSec: probed };
		}),
	};
}

async function runAfterRecording(
	ctx: HookContext,
	deps: AudioRemuxDeps,
): Promise<void> {
	const outputs = outputsFor(ctx);
	// Scene ごとに名前空間を分ける。バッチは全 Scene に同じ sessionDir を渡すため、
	// 固定名だと次の Scene の抽出が前の Scene のメタデータを上書きしてしまう。
	const metadataPath = join(
		ctx.sessionDir,
		audioMetadataFileName(ctx.handoff.sceneName),
	);
	ctx.logger.debug("[audio-remux] phase=extract");
	const extracted = await deps.extractor.runExtraction(ctx, metadataPath);
	if (!extracted.ok)
		throwFailure(ctx, "extract", extracted.error.message, outputs);

	ctx.logger.debug("[audio-remux] phase=validate");
	const metadata = await deps.metadataLoader.loadAndValidate(metadataPath);
	if (!metadata.ok) {
		// 抽出側が自分で報告したエラー（サブアセット参照・音源ファイル欠落）を
		// 「検証に失敗した」と伝えると、利用者は JSON の不整合を疑って原因に
		// たどり着けない。抽出が何を見つけたのかが分かる文面にする（10.1）。
		throwFailure(
			ctx,
			"extract",
			metadata.error.kind === "extraction-errors"
				? `audio extraction reported errors: ${detail(metadata.error)}`
				: `metadata validation failed: ${detail(metadata.error)}`,
			outputs,
		);
	}

	// 計画より先に ffmpeg を取得する（音源長の確定に同梱の ffprobe が要るため）。
	// ただし「音声トラックが 1 つも無ければ 146 MB を取得しない」短絡は守る必要が
	// あるので、ここで安価な前判定を挟む。ミュートされていないクリップが 1 件も
	// 無ければ計画は必ず空になる。
	const audible = metadata.value.clips.filter((clip) => !clip.trackMuted);
	if (audible.length === 0) {
		ctx.logger.warn(
			"[audio-remux] no audio clips; keeping silent video as the final output",
		);
		return;
	}

	ctx.logger.debug("[audio-remux] phase=ffmpeg-acquire");
	const ffmpeg = await deps.ffmpegProvider.ensureFfmpeg();
	if (!ffmpeg.ok)
		throwFailure(ctx, "ffmpeg-acquire", detail(ffmpeg.error), outputs);

	ctx.logger.debug("[audio-remux] phase=probe");
	const metadataForPlan = await withProbedDurations(
		ctx,
		metadata.value,
		audible,
		ffmpeg.value.ffprobePath,
		deps.durationResolver,
	);

	const plan = deps.planner.buildMixPlan(metadataForPlan, ctx.handoff);
	if (plan.clips.length === 0) {
		ctx.logger.warn(
			"[audio-remux] no audio clips; keeping silent video as the final output",
		);
		return;
	}

	ctx.logger.debug("[audio-remux] phase=mux");
	const statuses: OutputMuxStatus[] = [];
	for (const output of [
		{ format: ctx.handoff.videoFormat, videoPath: ctx.handoff.videoPath },
		...ctx.handoff.additionalOutputs,
	]) {
		// ffmpeg infers the output container from the file extension, so the temp
		// name must keep it. A bare ".audiotmp" suffix makes ffmpeg fail with
		// "Unable to choose an output format" before it writes anything.
		const outputTmpPath = `${output.videoPath}.audiotmp${parse(output.videoPath).ext}`;
		const muxed = await deps.muxRunner.runMux({
			ffmpegPath: ffmpeg.value.ffmpegPath,
			videoPath: output.videoPath,
			outputTmpPath,
			sessionDir: ctx.sessionDir,
			graph: buildFilterGraph(plan),
			format: output.format,
			timeoutSec:
				Math.ceil(Math.max(0, ctx.handoff.outPoint - ctx.handoff.inPoint) * 2) +
				120,
			debug: ctx.debug,
			logger: (message) => ctx.logger.debug(message),
		});
		if (!muxed.ok) {
			statuses.push({
				format: output.format,
				videoPath: output.videoPath,
				outcome: "failure",
				errorDetail: detail(muxed.error),
			});
			continue;
		}
		const finalized = await deps.finalizer.finalizeOutput(
			output.videoPath,
			outputTmpPath,
			ctx.debug,
		);
		if (!finalized.ok) {
			statuses.push({
				format: output.format,
				videoPath: output.videoPath,
				outcome: "failure",
				errorDetail: detail(finalized.error),
			});
			continue;
		}
		for (const stale of finalized.value.staleArtifacts) {
			ctx.logger.warn(
				`[audio-remux] leftover from an interrupted previous run: ${stale} (not deleted; remove it manually once you have checked it)`,
			);
		}
		statuses.push({
			format: output.format,
			videoPath: output.videoPath,
			outcome: "success",
		});
	}
	if (statuses.some((status) => status.outcome === "failure")) {
		// core の hook wrapper は例外を message だけに縮退させるため、出力別の
		// 成否をここで文面に畳み込んでおかないと、成否一覧から「どの出力が音声付きで
		// どれが無音のままか」が判別できなくなる。構造化情報は AudioRemuxHookError の
		// outputs にも保持し続ける。
		const summary = statuses
			.map(
				(status) =>
					`${status.format}=${status.outcome}${status.errorDetail ? ` (${status.errorDetail})` : ""}`,
			)
			.join(", ");
		throwFailure(
			ctx,
			"mux",
			`one or more outputs failed during audio muxing: ${summary}`,
			statuses,
		);
	}
}

export function createAudioRemuxHooks(
	deps: Partial<AudioRemuxDeps> = {},
): RenderHooks {
	const resolved = { ...defaultDeps, ...deps };
	return { afterRecording: (ctx) => runAfterRecording(ctx, resolved) };
}

export type { AudioFailureCategory, OutputMuxStatus } from "./types.js";
export { AudioRemuxHookError } from "./types.js";

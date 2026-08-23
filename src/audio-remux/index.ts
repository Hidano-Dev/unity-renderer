import { dirname, join, parse } from "node:path";
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
import { DefaultMuxRunner, type MuxRunner } from "./ffmpeg/run.js";
import {
	AUDIO_METADATA_FILE_NAME,
	loadAudioTimelineMetadata,
} from "./metadata/load.js";
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
	readonly muxRunner: MuxRunner;
	readonly finalizer: OutputFinalizer;
}

const defaultDeps: AudioRemuxDeps = {
	extractor: createExtractService(),
	metadataLoader: {
		loadAndValidate: (path) => loadAudioTimelineMetadata(dirname(path)),
	},
	planner: { buildMixPlan },
	ffmpegProvider: createFfmpegAcquireManager(),
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
		{ format: "mp4", videoPath: ctx.handoff.videoPath, outcome: "skipped" },
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

async function runAfterRecording(
	ctx: HookContext,
	deps: AudioRemuxDeps,
): Promise<void> {
	const outputs = outputsFor(ctx);
	const metadataPath = join(ctx.sessionDir, AUDIO_METADATA_FILE_NAME);
	ctx.logger.debug("[audio-remux] phase=extract");
	const extracted = await deps.extractor.runExtraction(ctx, metadataPath);
	if (!extracted.ok)
		throwFailure(ctx, "extract", extracted.error.message, outputs);

	ctx.logger.debug("[audio-remux] phase=validate");
	const metadata = await deps.metadataLoader.loadAndValidate(metadataPath);
	if (!metadata.ok) {
		throwFailure(
			ctx,
			"extract",
			`metadata validation failed: ${detail(metadata.error)}`,
			outputs,
		);
	}

	const plan = deps.planner.buildMixPlan(metadata.value, ctx.handoff);
	if (plan.clips.length === 0) {
		ctx.logger.warn(
			"[audio-remux] no audio clips; keeping silent video as the final output",
		);
		return;
	}

	ctx.logger.debug("[audio-remux] phase=ffmpeg-acquire");
	const ffmpeg = await deps.ffmpegProvider.ensureFfmpeg();
	if (!ffmpeg.ok)
		throwFailure(ctx, "ffmpeg-acquire", detail(ffmpeg.error), outputs);

	ctx.logger.debug("[audio-remux] phase=mux");
	const statuses: OutputMuxStatus[] = [];
	for (const output of [
		{ format: "mp4" as const, videoPath: ctx.handoff.videoPath },
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
		statuses.push({
			format: output.format,
			videoPath: output.videoPath,
			outcome: "success",
		});
	}
	if (statuses.some((status) => status.outcome === "failure"))
		throwFailure(
			ctx,
			"mux",
			"one or more outputs failed during audio muxing",
			statuses,
		);
}

export function createAudioRemuxHooks(
	deps: Partial<AudioRemuxDeps> = {},
): RenderHooks {
	const resolved = { ...defaultDeps, ...deps };
	return { afterRecording: (ctx) => runAfterRecording(ctx, resolved) };
}

export type { AudioFailureCategory, OutputMuxStatus } from "./types.js";
export { AudioRemuxHookError } from "./types.js";

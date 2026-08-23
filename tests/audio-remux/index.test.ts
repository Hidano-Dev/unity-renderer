import { describe, expect, it, vi } from "vitest";
import type { AudioRemuxDeps } from "../../src/audio-remux/index.js";
import { createAudioRemuxHooks } from "../../src/audio-remux/index.js";
import type { AudioTimelineMetadata } from "../../src/audio-remux/metadata/schema.js";
import type { MixPlan } from "../../src/audio-remux/planner/mix-plan.js";
import type { HookContext } from "../../src/hooks/registry.js";
import { err, ok } from "../../src/shared/types.js";

const videoPath = "C:\\renders\\scene.mp4";
const movPath = "C:\\renders\\scene.mov";

const metadata: AudioTimelineMetadata = {
	schemaVersion: 1,
	sceneName: "Scene",
	extractedAt: "2026-08-23T00:00:00.000Z",
	clips: [],
	errors: [],
	warnings: [],
};

const planWithClip: MixPlan = {
	sampleRate: 48000,
	channels: 2,
	outputDurationSec: 10,
	clips: [
		{
			clipId: "clip-1",
			inputIndex: 0,
			sourcePath: "C:\\audio\\clip.wav",
			sourceSampleRate: 48000,
			loop: false,
			sourceTrimStartSec: 0,
			sourceTrimEndSec: 1,
			speed: 1,
			gain: 1,
			delaySamples: 0,
		},
	],
	skipped: [],
};

function context(): HookContext {
	return {
		handoff: {
			sceneName: "Scene",
			videoPath,
			additionalOutputs: [{ format: "mov-prores", videoPath: movPath }],
			effectiveFrameRate: 30,
			inPoint: 0,
			outPoint: 10,
		},
		debug: false,
		sessionDir: "C:\\sessions\\run-1",
		evalCSharp: vi.fn(),
		logger: { warn: vi.fn(), debug: vi.fn() },
	};
}

function baseDeps(overrides: Partial<AudioRemuxDeps> = {}): AudioRemuxDeps {
	return {
		extractor: { runExtraction: vi.fn(async () => ok(undefined)) },
		metadataLoader: {
			loadAndValidate: vi.fn(async () => ok(metadata)),
		},
		planner: { buildMixPlan: vi.fn(() => planWithClip) },
		ffmpegProvider: {
			ensureFfmpeg: vi.fn(async () =>
				ok({ ffmpegPath: "fake-ffmpeg", source: "manual" as const }),
			),
		},
		muxRunner: {
			runMux: vi.fn(async () => ok(undefined)),
		},
		finalizer: {
			finalizeOutput: vi.fn(async () => ok({ finalPath: videoPath })),
		},
		...overrides,
	};
}

function hook(deps: AudioRemuxDeps): (ctx: HookContext) => Promise<void> {
	const afterRecording = createAudioRemuxHooks(deps).afterRecording;
	if (!afterRecording) throw new Error("afterRecording hook was not created");
	return afterRecording;
}

describe("createAudioRemuxHooks", () => {
	it("runs extraction, planning, ffmpeg acquisition, mux, and finalization for every output", async () => {
		const deps = baseDeps();
		const ctx = context();

		await hook(deps)(ctx);

		expect(deps.extractor.runExtraction).toHaveBeenCalledWith(
			ctx,
			"C:\\sessions\\run-1\\timeline-audio-metadata.json",
		);
		expect(deps.metadataLoader.loadAndValidate).toHaveBeenCalledWith(
			"C:\\sessions\\run-1\\timeline-audio-metadata.json",
		);
		expect(deps.planner.buildMixPlan).toHaveBeenCalledWith(
			metadata,
			ctx.handoff,
		);
		expect(deps.ffmpegProvider.ensureFfmpeg).toHaveBeenCalledOnce();
		expect(deps.muxRunner.runMux).toHaveBeenCalledTimes(2);
		expect(deps.finalizer.finalizeOutput).toHaveBeenCalledWith(
			videoPath,
			`${videoPath}.audiotmp`,
			false,
		);
		expect(deps.finalizer.finalizeOutput).toHaveBeenCalledWith(
			movPath,
			`${movPath}.audiotmp`,
			false,
		);
	});

	it("skips muxing when the mix plan has no clips and reports a warning", async () => {
		const deps = baseDeps({
			planner: { buildMixPlan: vi.fn(() => ({ ...planWithClip, clips: [] })) },
		});
		const ctx = context();

		await expect(hook(deps)(ctx)).resolves.toBeUndefined();
		expect(deps.ffmpegProvider.ensureFfmpeg).not.toHaveBeenCalled();
		expect(deps.muxRunner.runMux).not.toHaveBeenCalled();
		expect(deps.finalizer.finalizeOutput).not.toHaveBeenCalled();
		expect(ctx.logger.warn).toHaveBeenCalledWith(
			"[audio-remux] no audio clips; keeping silent video as the final output",
		);
	});

	it("propagates extraction failures with skipped output statuses and preserved paths", async () => {
		const deps = baseDeps({
			extractor: {
				runExtraction: vi.fn(async () =>
					err({
						kind: "eval-failed" as const,
						message: "Unity extraction failed",
					}),
				),
			},
		});

		await expect(hook(deps)(context())).rejects.toMatchObject({
			name: "AudioRemuxHookError",
			category: "extract",
			sceneName: "Scene",
			message: "[audio-remux:extract] Unity extraction failed",
			preservedVideoPaths: [videoPath, movPath],
			outputs: [
				{ format: "mp4", videoPath, outcome: "skipped" },
				{ format: "mov-prores", videoPath: movPath, outcome: "skipped" },
			],
		});
	});

	it("propagates ffmpeg acquisition failures with skipped output statuses and preserved paths", async () => {
		const deps = baseDeps({
			ffmpegProvider: {
				ensureFfmpeg: vi.fn(async () =>
					err({
						kind: "network" as const,
						message: "download unavailable",
						manualInstallHint: "install fake ffmpeg",
					}),
				),
			},
		});

		await expect(hook(deps)(context())).rejects.toMatchObject({
			category: "ffmpeg-acquire",
			message: "[audio-remux:ffmpeg-acquire] download unavailable",
			preservedVideoPaths: [videoPath, movPath],
			outputs: [
				{ format: "mp4", videoPath, outcome: "skipped" },
				{ format: "mov-prores", videoPath: movPath, outcome: "skipped" },
			],
		});
	});

	it("propagates mixed mux results with per-output success/failure and preserved paths", async () => {
		const deps = baseDeps({
			muxRunner: {
				runMux: vi.fn(async (request) =>
					request.format === "mp4"
						? ok(undefined)
						: err({
								kind: "nonzero-exit" as const,
								exitCode: 3,
								stderrTail: "MOV mux failed",
							}),
				),
			},
		});

		await expect(hook(deps)(context())).rejects.toMatchObject({
			category: "mux",
			message:
				"[audio-remux:mux] one or more outputs failed during audio muxing",
			preservedVideoPaths: [videoPath, movPath],
			outputs: [
				{ format: "mp4", videoPath, outcome: "success" },
				{
					format: "mov-prores",
					videoPath: movPath,
					outcome: "failure",
					errorDetail: "MOV mux failed",
				},
			],
		});
		expect(deps.finalizer.finalizeOutput).toHaveBeenCalledTimes(1);
	});
});

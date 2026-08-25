import { describe, expect, it, vi } from "vitest";
import type { AudioRemuxDeps } from "../../src/audio-remux/index.js";
import { createAudioRemuxHooks } from "../../src/audio-remux/index.js";
import type { AudioTimelineMetadata } from "../../src/audio-remux/metadata/schema.js";
import type { MixPlan } from "../../src/audio-remux/planner/mix-plan.js";
import type { HookContext } from "../../src/hooks/registry.js";
import { err, ok } from "../../src/shared/types.js";

const videoPath = "C:\\renders\\scene.mp4";
const movPath = "C:\\renders\\scene.mov";

const audibleClip: AudioTimelineMetadata["clips"][number] = {
	id: "clip-1",
	trackPath: "A_Track",
	sourcePath: "C:\\audio\\clip.wav",
	sourceSampleRate: 48000,
	sourceDurationSec: 1,
	rootStartSec: 0,
	rootEndSec: 1,
	clipInSec: 0,
	effectiveSpeed: 1,
	clipVolume: 1,
	trackVolume: 1,
	trackMuted: false,
	loop: false,
};

const metadata: AudioTimelineMetadata = {
	schemaVersion: 1,
	sceneName: "Scene",
	extractedAt: "2026-08-23T00:00:00.000Z",
	clips: [audibleClip],
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
			videoFormat: "mp4",
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
		durationResolver: {
			resolveDurations: vi.fn(async () => ({
				durations: new Map<string, number>(),
				unresolved: [],
			})),
		},
		ffmpegProvider: {
			ensureFfmpeg: vi.fn(async () =>
				ok({
					ffmpegPath: "fake-ffmpeg",
					ffprobePath: "fake-ffprobe",
					source: "manual" as const,
				}),
			),
		},
		muxRunner: {
			runMux: vi.fn(async () => ok(undefined)),
		},
		finalizer: {
			finalizeOutput: vi.fn(async () =>
				ok({ finalPath: videoPath, staleArtifacts: [] as string[] }),
			),
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
			`${videoPath}.audiotmp.mp4`,
			false,
		);
		expect(deps.finalizer.finalizeOutput).toHaveBeenCalledWith(
			movPath,
			`${movPath}.audiotmp.mov`,
			false,
		);
	});

	// config の formats は順序自由で ["mov-prores"] や ["mov-prores", "mp4"] も有効。
	// 主出力を mp4 と決め打ちすると ProRes MOV に AAC が混ぜられ、失敗時の出力
	// ステータスも誤報になる。
	it("uses the handoff's primary format instead of assuming mp4", async () => {
		const deps = baseDeps();
		const ctx = context();
		const movPrimary: HookContext = {
			...ctx,
			handoff: {
				...ctx.handoff,
				videoPath: movPath,
				videoFormat: "mov-prores",
				additionalOutputs: [{ format: "mp4", videoPath }],
			},
		};

		await hook(deps)(movPrimary);

		const formats = (
			deps.muxRunner.runMux as unknown as {
				mock: { calls: [{ format: string }][] };
			}
		).mock.calls.map(([request]) => request.format);
		expect(formats).toEqual(["mov-prores", "mp4"]);
	});

	it("labels the primary output with its real format when muxing fails", async () => {
		const deps = baseDeps({
			muxRunner: {
				runMux: vi.fn(async () =>
					err({ kind: "nonzero-exit" as const, stderrTail: "boom" }),
				),
			},
		});
		const ctx = context();
		const movPrimary: HookContext = {
			...ctx,
			handoff: { ...ctx.handoff, videoFormat: "mov-prores" },
		};

		await expect(hook(deps)(movPrimary)).rejects.toMatchObject({
			category: "mux",
			outputs: expect.arrayContaining([
				expect.objectContaining({
					format: "mov-prores",
					videoPath,
					outcome: "failure",
				}),
			]),
		});
	});

	// ffprobe による音源長確定のため取得は計画より前に走る。そのぶん「音声トラックが
	// 1 つも無いのに 146 MB を落とす」ことがないよう、metadata 段階の前判定で止める。
	it("skips ffmpeg acquisition entirely when every track is muted", async () => {
		const deps = baseDeps({
			metadataLoader: {
				loadAndValidate: vi.fn(async () =>
					ok({
						...metadata,
						clips: [{ ...audibleClip, trackMuted: true }],
					}),
				),
			},
		});
		const ctx = context();

		await expect(hook(deps)(ctx)).resolves.toBeUndefined();
		expect(deps.ffmpegProvider.ensureFfmpeg).not.toHaveBeenCalled();
		expect(deps.planner.buildMixPlan).not.toHaveBeenCalled();
		expect(deps.muxRunner.runMux).not.toHaveBeenCalled();
		expect(ctx.logger.warn).toHaveBeenCalledWith(
			"[audio-remux] no audio clips; keeping silent video as the final output",
		);
	});

	it("skips muxing when the mix plan has no clips and reports a warning", async () => {
		const deps = baseDeps({
			planner: { buildMixPlan: vi.fn(() => ({ ...planWithClip, clips: [] })) },
		});
		const ctx = context();

		await expect(hook(deps)(ctx)).resolves.toBeUndefined();
		// metadata に可聴クリップがある以上、計画が空になると判るのは取得の後。
		// この経路では ffmpeg を取得済みだが mux は行わない。
		expect(deps.ffmpegProvider.ensureFfmpeg).toHaveBeenCalled();
		expect(deps.muxRunner.runMux).not.toHaveBeenCalled();
		expect(deps.finalizer.finalizeOutput).not.toHaveBeenCalled();
		expect(ctx.logger.warn).toHaveBeenCalledWith(
			"[audio-remux] no audio clips; keeping silent video as the final output",
		);
	});

	it("replaces Unity-reported source lengths with the ffprobe values before planning", async () => {
		const resolveDurations = vi.fn(async () => ({
			durations: new Map([["C:\\audio\\clip.wav", 2.5]]),
			unresolved: [],
		}));
		// The parameter is only declared so mock.calls is typed; the plan is fixed.
		const buildMixPlan = vi.fn(
			(_forPlan: AudioTimelineMetadata) => planWithClip,
		);
		const deps = baseDeps({
			durationResolver: { resolveDurations },
			planner: { buildMixPlan },
		});

		await hook(deps)(context());

		expect(resolveDurations).toHaveBeenCalledWith("fake-ffprobe", [
			"C:\\audio\\clip.wav",
		]);
		expect(buildMixPlan.mock.calls[0]?.[0].clips[0]?.sourceDurationSec).toBe(
			2.5,
		);
	});

	it("falls back to the Unity-reported lengths when ffprobe is unavailable", async () => {
		const resolveDurations = vi.fn();
		// The parameter is only declared so mock.calls is typed; the plan is fixed.
		const buildMixPlan = vi.fn(
			(_forPlan: AudioTimelineMetadata) => planWithClip,
		);
		const deps = baseDeps({
			durationResolver: { resolveDurations },
			planner: { buildMixPlan },
			ffmpegProvider: {
				ensureFfmpeg: vi.fn(async () =>
					ok({ ffmpegPath: "fake-ffmpeg", source: "manual" as const }),
				),
			},
		});
		const ctx = context();

		await hook(deps)(ctx);

		expect(resolveDurations).not.toHaveBeenCalled();
		expect(buildMixPlan.mock.calls[0]?.[0].clips[0]?.sourceDurationSec).toBe(1);
		expect(ctx.logger.warn).toHaveBeenCalledWith(
			expect.stringContaining("ffprobe not found"),
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
			// core の hook wrapper は message しか残さないため、出力別の成否が
			// 文面に畳み込まれていること自体が契約の一部。
			message:
				"[audio-remux:mux] one or more outputs failed during audio muxing: mp4=success, mov-prores=failure (MOV mux failed)",
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

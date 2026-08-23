import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAudioExtraction } from "../../../src/audio-remux/extract/run-extract.js";
import { DefaultMuxRunner } from "../../../src/audio-remux/ffmpeg/run.js";
import { createAudioRemuxHooks } from "../../../src/audio-remux/index.js";
import { loadAudioTimelineMetadata } from "../../../src/audio-remux/metadata/load.js";
import { DefaultOutputFinalizer } from "../../../src/audio-remux/output/finalize.js";
import { buildMixPlan } from "../../../src/audio-remux/planner/mix-plan.js";
import type { HookContext } from "../../../src/hooks/registry.js";
import { err, ok } from "../../../src/shared/types.js";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

async function fixture(clips: readonly object[]) {
	const root = await mkdtemp(join(tmpdir(), "audio-remux-integration-"));
	roots.push(root);
	const sessionDir = join(root, "session");
	const videoPath = join(root, "scene.mp4");
	const audioPath = join(root, "voice.wav");
	await writeFile(videoPath, "silent-video");
	await writeFile(audioPath, "audio-source");
	await mkdir(sessionDir, { recursive: true });
	await writeFile(
		join(root, "fake-ffmpeg.cjs"),
		[
			"const fs = require('node:fs');",
			"const args = process.argv.slice(2);",
			"if (process.env.FAKE_FFMPEG_FAIL === '1') { console.error('fake MOV failure'); process.exit(7); }",
			"fs.writeFileSync(args.at(-1), 'muxed-video-with-audio');",
			"fs.writeFileSync(process.env.FAKE_FFMPEG_RECORD, JSON.stringify(args));",
		].join("\n"),
	);
	const metadata = {
		schemaVersion: 1,
		sceneName: "Scene",
		extractedAt: "2026-08-23T00:00:00.000Z",
		clips,
		errors: [],
		warnings: [],
	};
	const metadataPath = join(sessionDir, "timeline-audio-metadata.json");
	const logger = { warn: () => undefined, debug: () => undefined };
	const context: HookContext = {
		handoff: {
			sceneName: "Scene",
			videoPath,
			additionalOutputs: [],
			effectiveFrameRate: 30,
			inPoint: 0,
			outPoint: 2,
		},
		debug: true,
		sessionDir,
		evalCSharp: async (_source) => {
			await writeFile(metadataPath, JSON.stringify(metadata));
			return ok({ returnValue: '{"ok":true}' });
		},
		logger,
	};
	return {
		root,
		sessionDir,
		videoPath,
		audioPath,
		metadataPath,
		context,
		ffmpegScript: join(root, "fake-ffmpeg.cjs"),
	};
}

function audioClip(sourcePath: string, id = "clip-1") {
	return {
		id,
		trackPath: "Root/Audio",
		sourcePath,
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
}

describe("audio remux integration hook flow", () => {
	it("runs real extraction, metadata, planning, mux, and finalization modules together", async () => {
		const test = await fixture([]);
		const clip = audioClip(test.audioPath);
		const metadata = JSON.stringify({
			schemaVersion: 1,
			sceneName: "Scene",
			extractedAt: "2026-08-23T00:00:00.000Z",
			clips: [clip],
			errors: [],
			warnings: [],
		});
		test.context.evalCSharp = async () => {
			await writeFile(test.metadataPath, metadata);
			return ok({ returnValue: '{"ok":true}' });
		};
		const recordPath = join(test.root, "args.json");
		const hook = createAudioRemuxHooks({
			extractor: { runExtraction: runAudioExtraction },
			metadataLoader: {
				loadAndValidate: (path) => loadAudioTimelineMetadata(dirname(path)),
			},
			planner: { buildMixPlan },
			ffmpegProvider: {
				ensureFfmpeg: async () =>
					ok({ ffmpegPath: process.execPath, source: "manual" as const }),
			},
			muxRunner: {
				runMux: (request) =>
					new DefaultMuxRunner().runMux({
						...request,
						commandPrefix: [test.ffmpegScript],
						env: { FAKE_FFMPEG_RECORD: recordPath },
					}),
			},
			finalizer: new DefaultOutputFinalizer(),
		}).afterRecording;

		await hook?.(test.context);
		expect(await readFile(test.videoPath, "utf8")).toBe(
			"muxed-video-with-audio",
		);
		const args = JSON.parse(await readFile(recordPath, "utf8")) as string[];
		expect(args).toContain("-c:v");
		expect(args).toContain("copy");
		expect(args).toContain("-filter_complex_script");
		expect(args.at(-1)).toBe(`${test.videoPath}.audiotmp`);
	});

	it("keeps the silent video and avoids ffmpeg when the real plan has zero clips", async () => {
		const test = await fixture([]);
		const hook = createAudioRemuxHooks({
			extractor: { runExtraction: runAudioExtraction },
			metadataLoader: {
				loadAndValidate: (path) => loadAudioTimelineMetadata(dirname(path)),
			},
			planner: { buildMixPlan },
			ffmpegProvider: {
				ensureFfmpeg: async () => {
					throw new Error("must not acquire ffmpeg");
				},
			},
		}).afterRecording;
		await hook?.(test.context);
		expect(await readFile(test.videoPath, "utf8")).toBe("silent-video");
	});

	it("returns the real extraction category when the fake Unity boundary fails", async () => {
		const test = await fixture([]);
		test.context.evalCSharp = async () =>
			err({
				kind: "eval-failed",
				message: "fake Unity unavailable",
				payloadId: "extract-audio",
			});
		const hook = createAudioRemuxHooks({
			extractor: { runExtraction: runAudioExtraction },
		}).afterRecording;
		await expect(hook?.(test.context)).rejects.toMatchObject({
			category: "extract",
			preservedVideoPaths: [test.videoPath],
		});
	});
});

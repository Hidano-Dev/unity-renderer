import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAudioExtraction } from "../../../src/audio-remux/extract/run-extract.js";
import { DefaultMuxRunner } from "../../../src/audio-remux/ffmpeg/run.js";
import { createAudioRemuxHooks } from "../../../src/audio-remux/index.js";
import { loadAudioTimelineMetadata } from "../../../src/audio-remux/metadata/load.js";
import { DefaultOutputFinalizer } from "../../../src/audio-remux/output/finalize.js";
import { buildMixPlan } from "../../../src/audio-remux/planner/mix-plan.js";
import type { HookContext } from "../../../src/hooks/registry.js";
import { ok } from "../../../src/shared/types.js";

const roots: string[] = [];
afterEach(async () =>
	Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	),
);

describe("audio remux dual-output integration", () => {
	it("finalizes MP4 while preserving MOV when the fake ffmpeg fails only for MOV", async () => {
		const root = await mkdtemp(join(tmpdir(), "audio-remux-dual-output-"));
		roots.push(root);
		const sessionDir = join(root, "session");
		const mp4 = join(root, "scene.mp4");
		const mov = join(root, "scene.mov");
		const audio = join(root, "voice.wav");
		const script = join(root, "fake-ffmpeg.cjs");
		const record = join(root, "args.jsonl");
		await Promise.all([
			writeFile(mp4, "silent-mp4"),
			writeFile(mov, "silent-mov"),
			writeFile(audio, "audio"),
		]);
		await writeFile(
			script,
			"const fs=require('node:fs'); const a=process.argv.slice(2); const out=a.at(-1); fs.appendFileSync(process.env.FAKE_RECORD, JSON.stringify(a)+'\\n'); if(out.endsWith('.mov.audiotmp.mov')) { process.exit(9); } fs.writeFileSync(out,'muxed-mp4');",
		);
		const metadataPath = join(sessionDir, "timeline-audio-metadata.Scene.json");
		await mkdir(sessionDir, { recursive: true });
		const context: HookContext = {
			handoff: {
				sceneName: "Scene",
				videoPath: mp4,
				videoFormat: "mp4",
				additionalOutputs: [{ format: "mov-prores", videoPath: mov }],
				effectiveFrameRate: 30,
				inPoint: 0,
				outPoint: 2,
			},
			debug: false,
			sessionDir,
			evalCSharp: async () => {
				await writeFile(
					metadataPath,
					JSON.stringify({
						schemaVersion: 1,
						sceneName: "Scene",
						extractedAt: "2026-08-23T00:00:00.000Z",
						clips: [
							{
								id: "clip-1",
								trackPath: "Root/Audio",
								sourcePath: audio,
								sourceDurationSec: 1,
								rootStartSec: 0,
								rootEndSec: 1,
								clipInSec: 0,
								effectiveSpeed: 1,
								clipVolume: 1,
								trackVolume: 1,
								trackMuted: false,
								loop: false,
							},
						],
						errors: [],
						warnings: [],
					}),
				);
				return ok({ returnValue: '{"ok":true}' });
			},
			logger: { warn: () => undefined, debug: () => undefined },
		};
		const hook = createAudioRemuxHooks({
			extractor: { runExtraction: runAudioExtraction },
			metadataLoader: {
				loadAndValidate: (path) =>
					loadAudioTimelineMetadata(dirname(path), basename(path)),
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
						commandPrefix: [script],
						env: { FAKE_RECORD: record },
					}),
			},
			finalizer: new DefaultOutputFinalizer(),
		}).afterRecording;

		await expect(hook?.(context)).rejects.toMatchObject({
			category: "mux",
			preservedVideoPaths: [mp4, mov],
			outputs: [
				{ format: "mp4", outcome: "success" },
				{ format: "mov-prores", outcome: "failure" },
			],
		});
		expect(await readFile(mp4, "utf8")).toBe("muxed-mp4");
		expect(await readFile(mov, "utf8")).toBe("silent-mov");
	});
});

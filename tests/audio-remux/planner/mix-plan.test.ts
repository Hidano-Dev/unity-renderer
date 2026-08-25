import { describe, expect, it } from "vitest";
import type { AudioTimelineMetadata } from "../../../src/audio-remux/metadata/schema.js";
import { buildMixPlan } from "../../../src/audio-remux/planner/mix-plan.js";
import type { RenderHandoff } from "../../../src/hooks/registry.js";

const handoff: RenderHandoff = {
	sceneName: "scene",
	videoPath: "video.mp4",
	videoFormat: "mp4",
	additionalOutputs: [],
	effectiveFrameRate: 30,
	inPoint: 10,
	outPoint: 20,
};

const metadata: AudioTimelineMetadata = {
	schemaVersion: 1,
	sceneName: "scene",
	extractedAt: "2026-08-23T00:00:00.000Z",
	clips: [
		{
			id: "muted",
			trackPath: "Muted",
			sourcePath: "muted.wav",
			sourceDurationSec: 2,
			rootStartSec: 10,
			rootEndSec: 12,
			clipInSec: 0,
			effectiveSpeed: 1,
			clipVolume: 1,
			trackVolume: 1,
			trackMuted: true,
			loop: false,
		},
		{
			id: "placed",
			trackPath: "Music",
			sourcePath: "music.wav",
			sourceDurationSec: 8,
			rootStartSec: 11,
			rootEndSec: 15,
			clipInSec: 0.5,
			effectiveSpeed: 2,
			clipVolume: 0.5,
			trackVolume: 0.8,
			trackMuted: false,
			loop: true,
		},
		{
			id: "outside",
			trackPath: "Music",
			sourcePath: "outside.wav",
			sourceDurationSec: 1,
			rootStartSec: 0,
			rootEndSec: 5,
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
};

describe("buildMixPlan", () => {
	it("creates placements and preserves skipped clip reasons", () => {
		const plan = buildMixPlan(metadata, handoff);

		expect(plan).toEqual({
			sampleRate: 48000,
			channels: 2,
			outputDurationSec: 10,
			clips: [
				{
					clipId: "placed",
					inputIndex: 0,
					sourcePath: "music.wav",
					loop: true,
					sourceTrimStartSec: 0.5,
					sourceTrimEndSec: 8.5,
					speed: 2,
					gain: 0.4,
					delaySamples: 48000,
				},
			],
			skipped: [
				{ clipId: "muted", reason: "track-muted" },
				{ clipId: "outside", reason: "empty-interval" },
			],
		});
	});

	it("keeps input indexes contiguous after skipped clips", () => {
		const plan = buildMixPlan(
			{
				...metadata,
				clips: metadata.clips.filter((clip) => clip.id !== "outside"),
			},
			handoff,
		);
		expect(plan.clips[0]?.inputIndex).toBe(0);
	});
});

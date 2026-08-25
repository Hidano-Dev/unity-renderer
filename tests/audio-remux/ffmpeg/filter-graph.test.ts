import { describe, expect, it } from "vitest";
import { buildFilterGraph } from "../../../src/audio-remux/ffmpeg/filter-graph.js";
import type { MixPlan } from "../../../src/audio-remux/planner/mix-plan.js";

const plan: MixPlan = {
	sampleRate: 48000,
	channels: 2,
	outputDurationSec: 3,
	clips: [
		{
			clipId: "mono",
			inputIndex: 0,
			sourcePath: "mono.wav",
			sourceSampleRate: 44100,
			loop: false,
			sourceTrimStartSec: 0.25,
			sourceTrimEndSec: 2.25,
			speed: 2,
			gain: 0.5,
			delaySamples: 12000,
		},
		{
			clipId: "loop",
			inputIndex: 1,
			sourcePath: "loop.wav",
			sourceSampleRate: 48000,
			loop: true,
			sourceTrimStartSec: 0,
			sourceTrimEndSec: 1.5,
			speed: 1,
			gain: 1,
			delaySamples: 0,
		},
	],
	skipped: [],
};

describe("buildFilterGraph", () => {
	it("builds the measured sample-exact resample graph", () => {
		const graph = buildFilterGraph(plan, "resample");

		expect(graph.inputArgs).toEqual([
			"-i",
			"mono.wav",
			"-stream_loop",
			"-1",
			"-i",
			"loop.wav",
		]);
		expect(graph.mixLabel).toBe("[mix]");
		// Stream specifiers start at 1: the mux command puts the video at input 0
		// and maps it with -map 0:v:0. Emitting [0:a] made ffmpeg abort with
		// "Stream specifier ':a' ... matches no streams" (caught by the real E2E,
		// not by this snapshot, which is why the offset is asserted explicitly).
		expect(graph.script).toBe(
			"[1:a]atrim=start=0.25:end=2.25,asetpts=N/SR/TB,asetrate=88200,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=0.5,adelay=12000S:all=1[a0];[2:a]atrim=start=0:end=1.5,asetpts=N/SR/TB,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a1];[a0][a1]amix=inputs=2:normalize=0:duration=longest[mixed];[mixed]apad,atrim=end_sample=144000,asetpts=N/SR/TB[mix]",
		);
		expect(graph.script).not.toContain("[0:a]");
		expect(graph.script).not.toContain("pan=");
	});

	it("offsets every clip stream specifier past the video input", () => {
		const graph = buildFilterGraph(plan, "resample");
		// One specifier per clip, each shifted by MUX_AUDIO_INPUT_OFFSET.
		expect([...graph.script.matchAll(/\[(\d+):a\]/g)].map((m) => m[1])).toEqual(
			["1", "2"],
		);
	});

	it("uses atempo for preserve-pitch and still fixes total output length", () => {
		const graph = buildFilterGraph(plan, "preserve-pitch");
		expect(graph.script).toContain("atempo=2");
		expect(graph.script).toContain(
			"[mixed]apad,atrim=end_sample=144000,asetpts=N/SR/TB[mix]",
		);
	});
});

import { describe, expect, it } from "vitest";
import { codecArgsFor } from "../../../src/audio-remux/ffmpeg/codec-matrix.js";

describe("codecArgsFor", () => {
	it.each([
		[
			"mp4",
			[
				"-c:a",
				"aac",
				"-ar",
				"48000",
				"-ac",
				"2",
				"-b:a",
				"256k",
				"-movflags",
				"+faststart",
			],
		],
		["mov-prores", ["-c:a", "pcm_s24le", "-ar", "48000", "-ac", "2"]],
	] as const)("selects the fixed %s matrix row", (format, expected) => {
		expect(codecArgsFor(format)).toEqual(expected);
	});
});

import { describe, expect, it } from "vitest";
import {
	type ClipTimeInput,
	placeClip,
} from "../../../src/audio-remux/planner/time-math.js";

const base: ClipTimeInput = {
	clipId: "clip",
	rootStartSec: 10,
	rootEndSec: 14,
	clipInSec: 0.25,
	sourceDurationSec: 3,
	effectiveSpeed: 2,
	loop: false,
	inPointSec: 0,
	outPointSec: 20,
};

describe("placeClip", () => {
	it("applies clipIn and speed, then computes the delay in 48 kHz samples", () => {
		const result = placeClip({ ...base, inPointSec: 11, outPointSec: 13.5 });

		expect(result).toEqual({
			status: "placed",
			clipId: "clip",
			sourceTrimStartSec: 2.25,
			sourceTrimEndSec: 3,
			speed: 2,
			loop: false,
			outputStartSec: 0,
			outputDurationSec: 2.5,
			delaySec: 0,
			delaySamples: 0,
			warnings: [],
		});
	});

	it("preserves the unwrapped source range for a looping clip", () => {
		const result = placeClip({
			...base,
			clipInSec: 0.5,
			sourceDurationSec: 1,
			effectiveSpeed: 1.5,
			loop: true,
			inPointSec: 11,
			outPointSec: 13,
		});

		expect(result.status).toBe("placed");
		if (result.status === "placed") {
			expect(result.sourceTrimStartSec).toBe(2);
			expect(result.sourceTrimEndSec).toBe(5);
			expect(result.delaySamples).toBe(0);
		}
	});

	it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
		"skips invalid effective speed %s",
		(effectiveSpeed) => {
			const result = placeClip({ ...base, effectiveSpeed });
			expect(result).toMatchObject({
				status: "skipped",
				reason: "invalid-time-value",
			});
		},
	);

	it("skips empty windows and zero-length sources without warnings", () => {
		expect(placeClip({ ...base, rootEndSec: 10 })).toEqual({
			status: "skipped",
			reason: "empty-interval",
			warnings: [],
		});
		expect(placeClip({ ...base, sourceDurationSec: 0 })).toEqual({
			status: "skipped",
			reason: "zero-source-duration",
			warnings: [],
		});
	});

	it("clamps negative clipIn and reports a warning", () => {
		const result = placeClip({ ...base, clipInSec: -1 });
		expect(result.status).toBe("placed");
		if (result.status === "placed") {
			expect(result.sourceTrimStartSec).toBe(0);
			expect(result.warnings).toEqual(["clip-in-clamped"]);
		}
	});

	it("naturally ends non-looping audio at the source end", () => {
		const result = placeClip({ ...base, inPointSec: 11, outPointSec: 20 });
		expect(result.status).toBe("placed");
		if (result.status === "placed") {
			expect(result.sourceTrimStartSec).toBe(2.25);
			expect(result.sourceTrimEndSec).toBe(3);
			expect(result.outputDurationSec).toBe(3);
		}
	});

	it("rounds delay to a non-negative sample count", () => {
		const result = placeClip({
			...base,
			rootStartSec: 10.000001,
			inPointSec: 10,
		});
		expect(result.status).toBe("placed");
		if (result.status === "placed") {
			expect(result.delaySamples).toBe(0);
			expect(result.delaySamples).toBeGreaterThanOrEqual(0);
		}
	});
});

import { describe, expect, it } from "vitest";
import { type BatchResult, toExitCode } from "../../src/reporting/exit-code.js";

const scene = (outcome: "success" | "failure") => ({
	sceneName: "Scene",
	outcome,
	warnings: [],
	outputs: [],
	durationSec: 1,
});

describe("toExitCode", () => {
	it("returns 0 when every scene and restoration succeed", () => {
		const result: BatchResult = {
			scenes: [scene("success")],
			restoreSucceeded: true,
		};
		expect(toExitCode(result)).toBe(0);
	});

	it("returns 2 when a scene fails and restoration succeeds", () => {
		const result: BatchResult = {
			scenes: [scene("success"), scene("failure")],
			restoreSucceeded: true,
		};
		expect(toExitCode(result)).toBe(2);
	});

	it("prioritizes restoration failure with exit code 3", () => {
		const result: BatchResult = {
			scenes: [scene("failure")],
			restoreSucceeded: false,
		};
		expect(toExitCode(result)).toBe(3);
	});
});

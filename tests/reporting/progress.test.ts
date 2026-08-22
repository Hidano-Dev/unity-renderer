import { describe, expect, it, vi } from "vitest";
import {
	createProgressReporter,
	formatExplorerLink,
	type SceneResult,
} from "../../src/reporting/progress.js";

const success: SceneResult = {
	sceneName: "Demo Scene",
	outcome: "success",
	warnings: [],
	outputs: [{ format: "mp4", videoPath: "C:\\renders\\Demo Scene.mp4" }],
	durationSec: 12.345,
};

describe("progress reporting", () => {
	it("prints the scene, outcome, duration, and a plain path for non-TTY output", () => {
		const output: string[] = [];
		const reporter = createProgressReporter({
			isTTY: false,
			write: (message) => output.push(message),
		});

		reporter.sceneStarted("Demo Scene", 1, 2);
		reporter.sceneFinished(success);
		reporter.batchSummary({ scenes: [success], restoreSucceeded: true });

		const text = output.join("");
		expect(text).toContain("Demo Scene");
		expect(text).toContain("成功");
		expect(text).toContain("12.35s");
		expect(text).toContain("C:\\renders\\Demo Scene.mp4");
		expect(text).not.toContain("\u001b]8;;");
	});

	it("uses OSC 8 only when stdout is a TTY", () => {
		expect(formatExplorerLink("C:\\renders\\Demo Scene.mp4", true)).toBe(
			"\u001b]8;;file:///C:/renders/Demo%20Scene.mp4\u001b\\Demo Scene.mp4\u001b]8;;\u001b\\",
		);
		expect(formatExplorerLink("C:\\renders\\Demo Scene.mp4", false)).toBe(
			"C:\\renders\\Demo Scene.mp4",
		);
	});

	it("does not mix debug logs into normal output", () => {
		const write = vi.fn();
		const reporter = createProgressReporter({ isTTY: false, write });

		reporter.debug("Unity verbose log");

		expect(write).not.toHaveBeenCalled();
	});

	it("includes debug logs when debug mode is enabled", () => {
		const output: string[] = [];
		const reporter = createProgressReporter({
			debug: true,
			isTTY: false,
			write: (message) => output.push(message),
		});

		reporter.debug("Unity verbose log");

		expect(output.join("")).toContain("Unity verbose log");
	});
});

import { describe, expect, it } from "vitest";
import {
	renderConfigSchema,
	validateRenderConfig,
} from "../../src/config/schema.js";

const validConfig = {
	projectPath: "C:\\work\\unity-project",
	scenes: ["Main"],
	resolution: { width: 1920, height: 1080 },
	frameRate: 60,
	formats: ["mp4", "mov-prores"],
	output: { directory: "C:\\renders", fileName: "<Scene>" },
};

describe("renderConfigSchema", () => {
	it("accepts the complete supported configuration", () => {
		const result = validateRenderConfig({
			...validConfig,
			range: { inPoint: 1, outPoint: 5 },
			debug: true,
			timeouts: { recordingSec: 120, editorStartSec: 600, editorQuitSec: 60 },
		});

		expect(result.ok).toBe(true);
	});

	it("reports missing required fields with their paths", () => {
		const result = validateRenderConfig({});

		expect(result).toMatchObject({
			ok: false,
			error: { kind: "validation-error" },
		});
		if (!result.ok) {
			expect(result.error.issues.map((issue) => issue.path)).toEqual(
				expect.arrayContaining([
					"projectPath",
					"scenes",
					"resolution",
					"frameRate",
					"formats",
					"output",
				]),
			);
		}
	});

	it("reports nested type and value errors with item paths", () => {
		const result = validateRenderConfig({
			...validConfig,
			scenes: ["Main", "Main"],
			resolution: { width: 0, height: "1080" },
			range: { inPoint: 10, outPoint: 5 },
			timeouts: { recordingSec: 0 },
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.issues.map((issue) => issue.path)).toEqual(
				expect.arrayContaining([
					"scenes",
					"resolution.width",
					"resolution.height",
					"range.outPoint",
					"timeouts.recordingSec",
				]),
			);
		}
	});

	it("rejects unsupported formats, scene paths, output paths, and unknown fields", () => {
		const result = renderConfigSchema.safeParse({
			...validConfig,
			scenes: ["Scenes/Main"],
			formats: ["webm"],
			output: { directory: "C:\\renders", fileName: "nested\\file" },
			preset: "default",
		});

		expect(result.success).toBe(false);
	});

	it("requires positive integer resolution and positive frame rate", () => {
		const result = validateRenderConfig({
			...validConfig,
			resolution: { width: 1920.5, height: -1 },
			frameRate: 0,
		});

		expect(result.ok).toBe(false);
	});
});

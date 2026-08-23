import { describe, expect, it } from "vitest";
import { validateRenderConfig } from "../../src/config/schema.js";
import { generateTemplate } from "../../src/config/template.js";

describe("generateTemplate", () => {
	it("returns valid JSON accepted by the render config schema", () => {
		const parsed: unknown = JSON.parse(generateTemplate());
		expect(validateRenderConfig(parsed).ok).toBe(true);
	});
});

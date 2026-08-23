import { describe, expect, it } from "vitest";
import {
	compilePayload,
	createPayloadCompiler,
	PARAMS_PLACEHOLDER,
	payloadTemplates,
} from "../../src/csharp-payloads/compile.js";

/** @test URC-8.1 @test URC-9.1 @test URC-10.1 @test URC-11.1 */

describe("csharp payload compiler", () => {
	it("loads every payload from an independent template and injects JSON once", () => {
		for (const id of [
			"open-scene",
			"setup-recorder",
			"start-recording",
			"quit-editor",
		] as const) {
			const params = { scenePath: 'C:\\work\\scene.cs"\n日本' };
			const result = compilePayload(id, params);
			expect(result.id).toBe(id);
			expect(result.source).not.toContain(PARAMS_PLACEHOLDER);
			expect(result.source).toContain(JSON.stringify(JSON.stringify(params)));
			expect(payloadTemplates[id]).toContain(PARAMS_PLACEHOLDER);
		}
	});

	it("preserves JSON values without assembling C# expressions", () => {
		const params = {
			path: 'C:\\動画\\a\\b".mp4',
			newline: "first\nsecond",
			count: 2,
			nested: { enabled: true },
		};
		const result = createPayloadCompiler().compile("open-scene", params);

		expect(result.source).toContain(JSON.stringify(JSON.stringify(params)));
	});
});

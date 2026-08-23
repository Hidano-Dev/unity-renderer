import { describe, expect, it } from "vitest";
import { compilePayload } from "../../src/csharp-payloads/compile.js";

/** @test URC-11.1 @test URC-11.2 */

describe("quit-editor payload", () => {
	it("exits the GUI Editor without saving project or scene assets", () => {
		const source = compilePayload("quit-editor", {
			reason: "recording-complete",
		}).source;

		expect(source).toMatchSnapshot();
		expect(source).toContain("EditorApplication.Exit(0)");
		expect(source).not.toContain("SaveAssets");
		expect(source).not.toContain("SaveScene");
		expect(source).not.toContain("SaveCurrentModifiedScenes");
	});
});

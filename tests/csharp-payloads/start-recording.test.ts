import { describe, expect, it } from "vitest";
import { compilePayload } from "../../src/csharp-payloads/compile.js";

/** @test URC-10.1 @test URC-10.2 @test URC-10.4 @test URC-10.5 @test URC-10.7 @test URC-11.1 */

describe("start-recording payload", () => {
	it("starts Play Mode recording and reports progress through an atomic status file", () => {
		const source = compilePayload("start-recording", {
			statusPath: "C:\\renders\\status.json",
			operationId: "scene-01-run-1",
		}).source;

		expect(source).toMatchSnapshot();
		expect(source).toContain("EditorApplication.isPlaying = true");
		expect(source).toContain("controller.PrepareRecording()");
		expect(source).toContain("controller.StartRecording()");
		expect(source).toContain("EditorApplication.update");
		expect(source).toContain("File.Move(tempPath, statusPath, true)");
		expect(source).toContain('WriteStatus("completed", 1, null)');
		expect(source).toContain('WriteStatus("failed", 0, exception.Message)');
	});
});

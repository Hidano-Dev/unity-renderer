import { describe, expect, it } from "vitest";
import { compilePayload } from "../../src/csharp-payloads/compile.js";

/** @test URC-9.1 @test URC-9.2 @test URC-9.3 @test URC-9.4 @test URC-9.5 @test URC-9.6 */

describe("setup-recorder payload (stage 1: prepare and enter Play Mode)", () => {
	it("validates the director, publishes preparing status, and requests Play Mode", () => {
		const source = compilePayload("setup-recorder", {
			statusPath: "C:\\sessions\\one\\scene-Intro.status.json",
			operationId: "Intro-1700000000000",
			directorName: "TimelineDirector",
		}).source;

		expect(source).toContain("PlayableDirector");
		// open-scene と同じ root 走査で Director を再選択する(入れ子・順序不定対策)
		expect(source).toContain("GetActiveScene().GetRootGameObjects()");
		expect(source).not.toContain("FindObjectsByType");
		expect(source).toContain("playOnAwake = false");
		expect(source).toContain('\\"state\\":\\"preparing\\"');
		expect(source).toContain("File.Replace(tempPath, statusPath, null)");
		expect(source).toContain("EditorApplication.isPlaying = true");
		// Recorder 構成はドメインリロードで消えるため、ステージ 1 では構築しない(P-7)
		expect(source).not.toContain("RecorderController");
		expect(source).not.toContain("MovieRecorderSettings");
		expect(source).not.toContain("CreateTrack");
		expect(source).not.toContain("CreateAsset");
	});

	it("injects parameters through JSON without assembling C# from strings", () => {
		const params = {
			statusPath: 'C:\\セッション\\take "1".status.json',
			operationId: "scene-01-run-1",
			directorName: "Director",
		};
		const source = compilePayload("setup-recorder", params).source;

		expect(source).toContain(JSON.stringify(JSON.stringify(params)));
	});
});

import { describe, expect, it } from "vitest";
import { compilePayload } from "../../src/csharp-payloads/compile.js";

/** @test URC-9.1 @test URC-9.2 @test URC-9.3 @test URC-9.4 @test URC-9.5 @test URC-9.6 */

describe("setup-recorder payload", () => {
	it("emits the approved in-memory dual-format recorder configuration", () => {
		const source = compilePayload("setup-recorder", {
			directorName: "TimelineDirector",
			outputs: [
				{ format: "mp4", absolutePath: "C:\\renders\\scene.mp4" },
				{ format: "mov", absolutePath: "C:\\renders\\scene.mov" },
			],
			width: 1920,
			height: 1080,
			frameRate: 30,
			inPoint: 1.5,
			outPoint: 4.5,
		}).source;

		expect(source).toContain(
			"CreateTrack<UnityEditor.Recorder.Timeline.RecorderTrack>",
		);
		expect(source).toContain(
			"CreateClip<UnityEditor.Recorder.Timeline.RecorderClip>",
		);
		expect(source).toContain(
			"ScriptableObject.CreateInstance<UnityEditor.Recorder.MovieRecorderSettings>()",
		);
		expect(source).toContain("HideFlags.DontSave");
		expect(source).toContain(
			"MovieRecorderSettings.VideoRecorderOutputFormat.MP4",
		);
		expect(source).toContain("ProResEncoderSettings");
		expect(source).toContain("CaptureAudio = false");
		expect(source).toContain("AsyncGPUReadback.WaitAllRequests()");
		expect(source).toContain("clip.start = inPoint");
		expect(source).toContain("clip.end = outPoint");
		expect(source).toContain("timeline.editorSettings.fps = frameRate");
		expect(source).not.toContain("CreateAsset");
	});

	it("injects output paths and recorder settings through JSON", () => {
		const source = compilePayload("setup-recorder", {
			outputs: [{ format: "mp4", absolutePath: 'C:\\動画\\take "1".mp4' }],
			width: 1280,
			height: 720,
			frameRate: 24,
			inPoint: 0,
			outPoint: 10,
		}).source;

		expect(source).toContain(
			JSON.stringify(
				JSON.stringify({
					outputs: [{ format: "mp4", absolutePath: 'C:\\動画\\take "1".mp4' }],
					width: 1280,
					height: 720,
					frameRate: 24,
					inPoint: 0,
					outPoint: 10,
				}),
			),
		);
	});
});

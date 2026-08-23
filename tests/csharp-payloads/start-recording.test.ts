import { describe, expect, it } from "vitest";
import { compilePayload } from "../../src/csharp-payloads/compile.js";

/** @test URC-9.1 @test URC-9.2 @test URC-9.3 @test URC-9.4 @test URC-9.5 @test URC-9.6 @test URC-10.1 @test URC-10.2 @test URC-10.4 @test URC-10.5 @test URC-10.7 @test URC-11.1 */

const params = {
	statusPath: "C:\\sessions\\one\\scene-Intro.status.json",
	operationId: "Intro-1700000000000",
	directorName: "TimelineDirector",
	outputs: [
		{ format: "mp4", absolutePath: "C:\\renders\\scene.mp4" },
		{ format: "mov-prores", absolutePath: "C:\\renders\\scene.mov" },
	],
	width: 1920,
	height: 1080,
	frameRate: 30,
	inPoint: 1.5,
	outPoint: 4.5,
};

describe("start-recording payload (stage 2: rebuild in Play Mode and record)", () => {
	it("guards on Play Mode and rebuilds the in-memory recorder configuration", () => {
		const source = compilePayload("start-recording", params).source;

		expect(source).toMatchSnapshot();
		// Play Mode 遷移前は副作用なしで失敗し、CLI 側のリトライに委ねる
		expect(source).toContain("PLAY_MODE_NOT_READY");
		// open-scene と同じ root 走査で Director を再選択する(入れ子・順序不定対策)
		expect(source).toContain("GetActiveScene().GetRootGameObjects()");
		expect(source).not.toContain("FindObjectsByType");
		expect(source).toContain(
			"new UnityEditor.Recorder.RecorderController(controllerSettings)",
		);
		expect(source).toContain(
			"CreateInstance<UnityEditor.Recorder.RecorderControllerSettings>()",
		);
		expect(source).toContain(
			"CreateInstance<UnityEditor.Recorder.MovieRecorderSettings>()",
		);
		expect(source).toContain("HideFlags.DontSave");
		expect(source).toContain(
			"SetRecordModeToFrameInterval(0, totalFrames - 1)",
		);
		expect(source).toContain("CapFrameRate = true");
		expect(source).toContain(
			"UnityEditor.Recorder.Encoder.CoreEncoderSettings",
		);
		expect(source).toContain(
			"UnityEditor.Recorder.Encoder.ProResEncoderSettings",
		);
		expect(source).toContain("CaptureAudio = false");
		expect(source).toContain("GameViewInputSettings");
		// Requirement 9.5: 開始前の 1 回だけでなく、録画中も毎フレーム同期する
		expect(source.split("AsyncGPUReadback.WaitAllRequests()")).toHaveLength(3);
		expect(source).toContain("SessionState.SetString(StartedOperationKey");
		expect(source).toContain("SessionState.GetString(StartedOperationKey");
		expect(source).toContain("controller.PrepareRecording()");
		expect(source).toContain("controller.StartRecording()");
		// OutputFile は拡張子を自動付与するため、拡張子なしパスを設定する
		expect(source).toContain("GetFileNameWithoutExtension(outputPath)");
		expect(source).not.toContain("CreateAsset");
	});

	it("reports progress through an atomic status file per the RecordingStatus contract", () => {
		const source = compilePayload("start-recording", params).source;

		expect(source).toContain("EditorApplication.update");
		expect(source).toContain("File.Replace(tempPath, statusPath, null)");
		expect(source).toContain('\\"elapsedSec\\":');
		expect(source).toContain('StatusJson("recording"');
		expect(source).toContain('StatusJson("completed"');
		expect(source).toContain('\\"timelineDurationSec\\":');
		expect(source).toContain('StatusJson("failed"');
		expect(source).toContain('\\"reason\\":');
	});

	it("parses JSON numbers written in exponent notation", () => {
		const source = compilePayload("start-recording", {
			...params,
			frameRate: 1e-7,
		}).source;

		// 指数表記の値がそのまま渡るため、C# 側も指数部を含めて解析する必要がある
		expect(source).toContain("1e-7");
		expect(source).toContain("[eE][+-]?[0-9]+");
		expect(source).toContain("NumberStyles.Float");
	});

	it("injects recorder parameters through JSON", () => {
		const source = compilePayload("start-recording", {
			...params,
			outputs: [{ format: "mp4", absolutePath: 'C:\\動画\\take "1".mp4' }],
		}).source;

		expect(source).toContain(
			JSON.stringify(
				JSON.stringify({
					...params,
					outputs: [{ format: "mp4", absolutePath: 'C:\\動画\\take "1".mp4' }],
				}),
			),
		);
	});
});

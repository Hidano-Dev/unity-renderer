import { describe, expect, it } from "vitest";
import { compileAudioExtractionPayload } from "../../../src/audio-remux/extract/payload.js";

describe("audio extraction payload", () => {
	it("injects the scene and metadata paths into the eval payload", () => {
		const result = compileAudioExtractionPayload({
			scenePath: "Assets/Scenes/Main.unity",
			metadataFilePath: "C:\\session\\timeline-audio-metadata.json",
			sceneName: "Main",
		});

		expect(result.source).toContain(
			'"scenePath\\":\\"Assets/Scenes/Main.unity',
		);
		expect(result.source).toContain("metadataFilePath");
		expect(result.source).not.toContain("/*__PARAMS_JSON__*/");
		expect(result.source).toContain("TimelineAsset");
		expect(result.source).toContain("GetOutputTracks()");
		expect(result.source).toContain("m_ClipProperties.volume");
		expect(result.source).toContain("m_TrackProperties.volume");
		expect(result.source).toContain("sourceGameObject.Resolve(owner)");
		expect(result.source).toContain("TrackAsset");
		expect(result.source).toContain(
			"File.Replace(temporaryPath, metadataFilePath, null)",
		);
		expect(result.source).toContain(
			"File.Move(temporaryPath, metadataFilePath)",
		);
		expect(result.source).toContain("System.Text.StringBuilder");
		expect(result.source).not.toContain("JsonUtility");
		expect(result.source).not.toMatch(/^\s*using\s/m);
	});
});

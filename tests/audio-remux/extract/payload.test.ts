import { describe, expect, it } from "vitest";
import { compileAudioExtractionPayload } from "../../../src/audio-remux/extract/payload.js";

describe("audio extraction payload", () => {
	it("injects the scene name and metadata path into the eval payload", () => {
		const result = compileAudioExtractionPayload({
			metadataFilePath: "C:\\session\\timeline-audio-metadata.json",
			sceneName: "Main",
		});

		expect(result.source).toContain('"sceneName\\":\\"Main');
		expect(result.source).toContain("metadataFilePath");
		// The payload must read the ACTIVE scene, never re-open one: the hook runs
		// in the session that already recorded it, and re-opening would mutate
		// project state (requirement 8.4).
		expect(result.source).toContain(
			"UnityEngine.SceneManagement.SceneManager.GetActiveScene()",
		);
		expect(result.source).not.toContain("OpenScene");
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

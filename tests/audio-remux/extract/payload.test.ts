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

	// The payload is C# executed inside Unity, so these are string checks; the
	// behaviour itself is proven by the clamp fixture in the E2E checklist.
	it("excludes clips that miss the ancestor visible window", () => {
		const result = compileAudioExtractionPayload({
			metadataFilePath: "C:\\session\\timeline-audio-metadata.json",
			sceneName: "Main",
		});

		// Emitting such a clip yields rootEndSec <= rootStartSec, which fails the
		// receiving schema and takes the whole scene's audio down with it.
		expect(result.source).toContain("if (visibleEnd <= visibleStart)");
		expect(result.source).toContain("outside-visible-window");
	});

	it("advances clipIn by the amount the visible window clamped off the head", () => {
		const result = compileAudioExtractionPayload({
			metadataFilePath: "C:\\session\\timeline-audio-metadata.json",
			sceneName: "Main",
		});

		// Replacing the start with visibleStart while leaving clipIn untouched
		// shifts the nested timeline's audio content by the clamped amount.
		expect(result.source).toContain("if (visibleStart > rootStart)");
		expect(result.source).toContain(
			"clipIn += (visibleStart - rootStart) * effectiveSpeed;",
		);
	});
});

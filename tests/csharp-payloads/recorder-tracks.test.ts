import { describe, expect, it } from "vitest";
import { compilePayload } from "../../src/csharp-payloads/compile.js";

function source(mode: "scan" | "remove"): string {
	return compilePayload("recorder-tracks", { directorName: "Director", mode })
		.source;
}

describe("recorder-tracks payload", () => {
	it("selects the root director the same way setup-recorder does", () => {
		const compiled = source("scan");

		expect(compiled).toContain("GetActiveScene().GetRootGameObjects()");
		expect(compiled).toContain(
			"GetComponent<UnityEngine.Playables.PlayableDirector>()",
		);
		expect(compiled).not.toContain("GetComponentsInChildren");
	});

	it("resolves RecorderTrack by name and fails loudly when it is absent", () => {
		const compiled = source("scan");

		expect(compiled).toContain("UnityEditor.Recorder.Timeline.RecorderTrack");
		expect(compiled).toContain("IsAssignableFrom");
		// 型が見つからないまま 0 件と報告すると、二重書き出しを素通りさせてしまう
		expect(compiled).toContain("RecorderTrack type was not found");
	});

	it("walks nested Timelines through ControlTrack with a cycle guard", () => {
		const compiled = source("scan");

		expect(compiled).toContain("UnityEngine.Timeline.ControlTrack");
		expect(compiled).toContain("control.sourceGameObject.Resolve(owner)");
		expect(compiled).toContain("GetChildTracks()");
		expect(compiled).toContain("nested-timeline-cycle");
		expect(compiled).toContain("nested-timeline-too-deep");
	});

	it("deletes tracks without ever saving the scene or the asset", () => {
		const compiled = source("remove");

		expect(compiled).toContain("timeline.DeleteTrack(track)");
		// メモリ上だけの削除であることが前提。保存 API を呼ぶと .playable が壊れる
		expect(compiled).not.toContain("AssetDatabase.SaveAssets");
		expect(compiled).not.toContain("EditorSceneManager.SaveScene");
	});

	it("reports the asset path and the post-removal timeline length", () => {
		const compiled = source("remove");

		expect(compiled).toContain(
			"UnityEditor.AssetDatabase.GetAssetPath(timeline)",
		);
		expect(compiled).toContain("rootTimeline.duration");
		expect(compiled).toContain("rootTimeline.editorSettings.fps");
	});

	it("rejects an unknown mode instead of guessing", () => {
		const compiled = compilePayload("recorder-tracks", {
			directorName: "Director",
			mode: "wipe",
		}).source;

		expect(compiled).toContain("mode must be scan or remove");
	});
});

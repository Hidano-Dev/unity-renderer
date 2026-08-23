import { describe, expect, it } from "vitest";
import { compilePayload } from "../../src/csharp-payloads/compile.js";

/** @test URC-8.1 @test URC-8.2 @test URC-8.3 @test URC-8.4 */

describe("open-scene payload", () => {
	it("emits the approved scene-open and root-director detection payload", () => {
		const result = compilePayload("open-scene", {
			scenePath: "Assets/Scenes/Spike.unity",
		});

		expect(result.source).toMatchInlineSnapshot(`
			"// Unity eval payload: open a scene without prompting to save and inspect root directors.
var parametersJson = "{\\"scenePath\\":\\"Assets/Scenes/Spike.unity\\"}";
string ExtractJsonString(string json, string key)
{
    var match = System.Text.RegularExpressions.Regex.Match(json, "\\\\\\"" + key + "\\\\\\"\\\\s*:\\\\s*\\\\\\"((?:\\\\\\\\.|[^\\\\\\"\\\\\\\\])*)\\\\\\"");
    if (!match.Success)
        throw new System.ArgumentException("Missing required payload parameter: " + key);
    return System.Text.RegularExpressions.Regex.Unescape(match.Groups[1].Value);
}
string EscapeJson(string value)
{
    return value.Replace("\\\\", "\\\\\\\\").Replace("\\\\\\"", "\\\\\\\\\\"").Replace("\\r", "\\\\r").Replace("\\n", "\\\\n");
}
var scenePath = ExtractJsonString(parametersJson, "scenePath");
var scene = UnityEditor.SceneManagement.EditorSceneManager.OpenScene(scenePath, UnityEditor.SceneManagement.OpenSceneMode.Single);
var directors = new System.Collections.Generic.List<UnityEngine.Playables.PlayableDirector>();
foreach (var root in scene.GetRootGameObjects())
{
    var directorOnRoot = root.GetComponent<UnityEngine.Playables.PlayableDirector>();
    if (directorOnRoot != null)
        directors.Add(directorOnRoot);
}
if (directors.Count == 0)
    return "{\\"directorFound\\":false,\\"multipleDirectorsWarning\\":false,\\"directorName\\":null,\\"timelineDurationSec\\":null,\\"timelineFrameRate\\":null}";
var director = directors[0];
var timeline = director.playableAsset as UnityEngine.Timeline.TimelineAsset;
var duration = timeline == null ? "null" : timeline.duration.ToString(System.Globalization.CultureInfo.InvariantCulture);
var frameRate = timeline == null ? "null" : timeline.editorSettings.fps.ToString(System.Globalization.CultureInfo.InvariantCulture);
return "{\\"directorFound\\":true,\\"multipleDirectorsWarning\\":" + (directors.Count > 1 ? "true" : "false") + ",\\"directorName\\":\\"" + EscapeJson(director.name) + "\\",\\"timelineDurationSec\\":" + duration + ",\\"timelineFrameRate\\":" + frameRate + "}";
"
		`);
	});

	it("contains the required API sequence and excludes nested hierarchy search", () => {
		const source = compilePayload("open-scene", {
			scenePath: "Assets/Main.unity",
		}).source;

		expect(source).toContain("EditorSceneManager.OpenScene");
		expect(source).toContain("OpenSceneMode.Single");
		expect(source).toContain("GetRootGameObjects()");
		expect(source).toContain(
			"GetComponent<UnityEngine.Playables.PlayableDirector>()",
		);
		expect(source).toContain("timeline.duration");
		expect(source).toContain("timeline.editorSettings.fps");
		expect(source).toContain("multipleDirectorsWarning");
		expect(source).not.toContain("GetComponentsInChildren");
	});
});

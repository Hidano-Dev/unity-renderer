// Unity eval payload: open a scene without prompting to save and inspect root directors.
var parametersJson = /*__PARAMS_JSON__*/;
string ExtractJsonString(string json, string key)
{
    var match = System.Text.RegularExpressions.Regex.Match(json, "\\\"" + key + "\\\"\\s*:\\s*\\\"((?:\\\\.|[^\\\"\\\\])*)\\\"");
    if (!match.Success)
        throw new System.ArgumentException("Missing required payload parameter: " + key);
    return System.Text.RegularExpressions.Regex.Unescape(match.Groups[1].Value);
}
string EscapeJson(string value)
{
    return value.Replace("\\", "\\\\").Replace("\\\"", "\\\\\"").Replace("\r", "\\r").Replace("\n", "\\n");
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
    return "{\"directorFound\":false,\"multipleDirectorsWarning\":false,\"directorName\":null,\"timelineDurationSec\":null,\"timelineFrameRate\":null}";
var director = directors[0];
var timeline = director.playableAsset as UnityEngine.Timeline.TimelineAsset;
var duration = timeline == null ? "null" : timeline.duration.ToString(System.Globalization.CultureInfo.InvariantCulture);
var frameRate = timeline == null ? "null" : timeline.editorSettings.fps.ToString(System.Globalization.CultureInfo.InvariantCulture);
return "{\"directorFound\":true,\"multipleDirectorsWarning\":" + (directors.Count > 1 ? "true" : "false") + ",\"directorName\":\"" + EscapeJson(director.name) + "\",\"timelineDurationSec\":" + duration + ",\"timelineFrameRate\":" + frameRate + "}";

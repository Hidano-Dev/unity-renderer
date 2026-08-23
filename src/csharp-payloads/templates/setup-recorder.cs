// Unity eval payload (stage 1 of 2): prepare the recording pass.
// The in-memory Recorder configuration is deliberately NOT built here: the domain
// reload triggered by entering Play Mode would wipe it (spike P-7). Instead this
// payload validates the target director, publishes the "preparing" status, and
// requests Play Mode. start-recording.cs rebuilds the Recorder configuration
// inside Play Mode where it survives until the recording completes.
var parametersJson = /*__PARAMS_JSON__*/;

string JsonString(string json, string key)
{
    var match = System.Text.RegularExpressions.Regex.Match(json, "\\\"" + key + "\\\"\\s*:\\s*\\\"((?:\\\\.|[^\\\"\\\\])*)\\\"");
    if (!match.Success)
        throw new System.ArgumentException("Missing required payload parameter: " + key);
    return System.Text.RegularExpressions.Regex.Unescape(match.Groups[1].Value);
}
string JsonEscape(string value)
{
    return value.Replace("\\", "\\\\").Replace("\"", "\\\"");
}

var statusPath = JsonString(parametersJson, "statusPath");
var operationId = JsonString(parametersJson, "operationId");
var directorName = JsonString(parametersJson, "directorName");

var statusDirectory = System.IO.Path.GetDirectoryName(statusPath);
if (string.IsNullOrEmpty(statusDirectory))
    throw new System.ArgumentException("statusPath must include a directory");
System.IO.Directory.CreateDirectory(statusDirectory);

var directorObject = System.Linq.Enumerable.FirstOrDefault(
    UnityEngine.Object.FindObjectsByType<UnityEngine.Playables.PlayableDirector>(
        UnityEngine.FindObjectsSortMode.None),
    director => director.name == directorName);
if (directorObject == null)
    throw new System.ArgumentException("PlayableDirector not found: " + directorName);
if (directorObject.playableAsset as UnityEngine.Timeline.TimelineAsset == null)
    throw new System.ArgumentException("PlayableDirector has no TimelineAsset: " + directorName);

// Keep the timeline from free-running before start-recording.cs seeks to the
// requested in point. This edit-mode change is memory-only: the scene is never
// saved and quit-editor.cs exits without saving.
directorObject.playOnAwake = false;

// Atomic status write: temp file then swap, so the CLI never reads partial JSON.
// File.Move(src, dst, overwrite) is unavailable in Unity's C# profile; use the
// atomic File.Replace when the destination exists.
var tempPath = statusPath + ".tmp";
var preparingJson = "{\"operationId\":\"" + JsonEscape(operationId) + "\",\"state\":\"preparing\"}";
System.IO.File.WriteAllText(tempPath, preparingJson, new System.Text.UTF8Encoding(false));
if (System.IO.File.Exists(statusPath))
    System.IO.File.Replace(tempPath, statusPath, null);
else
    System.IO.File.Move(tempPath, statusPath);

UnityEditor.EditorApplication.isPlaying = true;
return "{\"playModeRequested\":true,\"directorName\":\"" + JsonEscape(directorName) + "\"}";

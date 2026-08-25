// Unity eval payload: inspect and remove user-authored RecorderTracks before recording.
//
// The CLI configures Recorder through the RecorderController API inside Play Mode
// (start-recording.cs). A RecorderTrack left on the Timeline records in parallel and
// writes its own files, so the scene must be cleaned before the recording pass is set up.
//
// mode="scan"   read-only; reports the Timeline assets that hold RecorderTracks so the
//               CLI can back them up before anything is mutated.
// mode="remove" deletes those tracks IN MEMORY ONLY. Nothing here saves the scene or the
//               asset, and quit-editor.cs exits without saving, so the .playable files on
//               disk stay untouched and the tracks are back the next time Unity loads them.
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
    if (value == null) return "";
    return value.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n");
}

string JsonString(string value)
{
    return "\"" + EscapeJson(value) + "\"";
}

string Number(double value)
{
    if (double.IsNaN(value) || double.IsInfinity(value)) return "null";
    return value.ToString("R", System.Globalization.CultureInfo.InvariantCulture);
}

string TrackPath(UnityEngine.Timeline.TrackAsset track)
{
    var parts = new System.Collections.Generic.List<string>();
    var current = track;
    while (current != null)
    {
        parts.Insert(0, current.name);
        current = current.parent as UnityEngine.Timeline.TrackAsset;
    }
    return string.Join("/", parts.ToArray());
}

var directorName = ExtractJsonString(parametersJson, "directorName");
var mode = ExtractJsonString(parametersJson, "mode");
if (mode != "scan" && mode != "remove")
    return "{\"ok\":false,\"error\":\"mode must be scan or remove\"}";

// Resolving the type by name keeps this payload compiling even where Recorder is absent,
// but a silent miss would look like "no tracks to clean" and let a double recording through.
// Not finding the type at all is therefore a hard error, not an empty result.
System.Type recorderTrackType = null;
foreach (var assembly in System.AppDomain.CurrentDomain.GetAssemblies())
{
    var candidate = assembly.GetType("UnityEditor.Recorder.Timeline.RecorderTrack", false);
    if (candidate != null) { recorderTrackType = candidate; break; }
}
if (recorderTrackType == null)
    return "{\"ok\":false,\"error\":\"RecorderTrack type was not found; com.unity.recorder is missing or its API changed\"}";

// setup-recorder.cs selects the director the same way: scan the active scene's roots in
// order. A whole-scene search would also pick up nested directors in an undefined order.
UnityEngine.Playables.PlayableDirector rootDirector = null;
foreach (var root in UnityEngine.SceneManagement.SceneManager.GetActiveScene().GetRootGameObjects())
{
    var candidate = root.GetComponent<UnityEngine.Playables.PlayableDirector>();
    if (candidate != null && candidate.name == directorName)
    {
        rootDirector = candidate;
        break;
    }
}
if (rootDirector == null)
    return "{\"ok\":false,\"error\":\"Root PlayableDirector not found: " + EscapeJson(directorName) + "\"}";

var rootTimeline = rootDirector.playableAsset as UnityEngine.Timeline.TimelineAsset;
if (rootTimeline == null)
    return "{\"ok\":false,\"error\":\"PlayableDirector has no TimelineAsset: " + EscapeJson(directorName) + "\"}";

var warnings = new System.Collections.Generic.List<string>();
var entries = new System.Collections.Generic.List<string>();
var visited = new System.Collections.Generic.HashSet<int>();
var removedCount = 0;

var pending = new System.Collections.Generic.Queue<object[]>();
pending.Enqueue(new object[] { rootTimeline, rootDirector, "root", 0 });

while (pending.Count > 0)
{
    var current = pending.Dequeue();
    var timeline = (UnityEngine.Timeline.TimelineAsset)current[0];
    var owner = (UnityEngine.Playables.PlayableDirector)current[1];
    var chain = (string)current[2];
    var depth = (int)current[3];
    if (timeline == null) continue;
    if (depth > 32)
    {
        warnings.Add("nested-timeline-too-deep: " + chain);
        continue;
    }
    // A ControlTrack can point back at an ancestor director; without this the walk loops.
    if (!visited.Add(timeline.GetInstanceID()))
    {
        warnings.Add("nested-timeline-cycle: " + chain);
        continue;
    }

    // GroupTrack children are not returned by GetOutputTracks in every Timeline version,
    // so walk the tree explicitly: a RecorderTrack inside a group records all the same.
    var flattened = new System.Collections.Generic.List<UnityEngine.Timeline.TrackAsset>();
    var stack = new System.Collections.Generic.Stack<UnityEngine.Timeline.TrackAsset>();
    foreach (var rootTrack in timeline.GetRootTracks()) stack.Push(rootTrack);
    while (stack.Count > 0)
    {
        var track = stack.Pop();
        if (track == null) continue;
        flattened.Add(track);
        foreach (var child in track.GetChildTracks()) stack.Push(child);
    }

    var assetPath = UnityEditor.AssetDatabase.GetAssetPath(timeline);
    var recorderTracks = new System.Collections.Generic.List<UnityEngine.Timeline.TrackAsset>();
    foreach (var track in flattened)
    {
        if (recorderTrackType.IsAssignableFrom(track.GetType()))
        {
            recorderTracks.Add(track);
            continue;
        }

        var controlTrack = track as UnityEngine.Timeline.ControlTrack;
        if (controlTrack == null) continue;
        foreach (var clip in controlTrack.GetClips())
        {
            var control = clip.asset as UnityEngine.Timeline.ControlPlayableAsset;
            if (control == null) continue;
            var target = control.sourceGameObject.Resolve(owner);
            if (target == null)
            {
                warnings.Add("control-clip-unresolved: " + chain + " -> " + TrackPath(controlTrack) + "/" + clip.displayName);
                continue;
            }
            var childDirector = target.GetComponent<UnityEngine.Playables.PlayableDirector>();
            var childTimeline = childDirector == null ? null : childDirector.playableAsset as UnityEngine.Timeline.TimelineAsset;
            if (childDirector == null || childTimeline == null) continue;
            pending.Enqueue(new object[] { childTimeline, childDirector, chain + " > " + clip.displayName, depth + 1 });
        }
    }

    if (recorderTracks.Count == 0) continue;
    if (string.IsNullOrEmpty(assetPath))
        // Without a project path the CLI cannot back the asset up. The removal itself is
        // memory-only, so report it and keep going rather than failing the scene.
        warnings.Add("timeline-asset-path-unavailable: " + chain);

    var trackPaths = new System.Collections.Generic.List<string>();
    foreach (var track in recorderTracks)
    {
        trackPaths.Add(JsonString(TrackPath(track)));
        // Collect first, delete after: DeleteTrack mutates the collections walked above.
        if (mode == "remove")
        {
            timeline.DeleteTrack(track);
            removedCount++;
        }
    }

    entries.Add("{\"assetPath\":" + JsonString(assetPath == null ? "" : assetPath) +
        ",\"chain\":" + JsonString(chain) +
        ",\"tracks\":[" + string.Join(",", trackPaths.ToArray()) + "]}");
}

var warningJson = new System.Collections.Generic.List<string>();
foreach (var warning in warnings) warningJson.Add(JsonString(warning));

// A RecorderTrack clip can be the longest thing on the Timeline, so removing it can
// shorten the duration open-scene.cs reported. Hand the post-removal values back and let
// the CLI re-derive the recording range from them.
return "{\"ok\":true,\"mode\":" + JsonString(mode) +
    ",\"timelines\":[" + string.Join(",", entries.ToArray()) + "]" +
    ",\"removed\":" + removedCount +
    ",\"timelineDurationSec\":" + Number(rootTimeline.duration) +
    ",\"timelineFrameRate\":" + Number(rootTimeline.editorSettings.fps) +
    ",\"warnings\":[" + string.Join(",", warningJson.ToArray()) + "]}";

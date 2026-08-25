// Unity eval payload: extract Timeline audio metadata and atomically write it.
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
    return value == null ? "null" : "\"" + EscapeJson(value) + "\"";
}

string Number(double value)
{
    if (double.IsNaN(value) || double.IsInfinity(value)) return "null";
    return value.ToString("R", System.Globalization.CultureInfo.InvariantCulture);
}

string Boolean(bool value) { return value ? "true" : "false"; }

void AppendJsonString(System.Text.StringBuilder builder, string value)
{
    builder.Append("\"").Append(EscapeJson(value)).Append("\"");
}

float ReadSerializedFloat(UnityEngine.Object target, string propertyPath, float fallback, System.Collections.Generic.List<string> warnings, string subject)
{
    if (target == null)
    {
        warnings.Add("invalid-time-value: " + subject + " " + propertyPath + " is unavailable; using 1.0");
        return fallback;
    }
    var serialized = new UnityEditor.SerializedObject(target);
    var property = serialized.FindProperty(propertyPath);
    if (property == null)
    {
        warnings.Add("invalid-time-value: " + subject + " " + propertyPath + " is unavailable; using 1.0");
        return fallback;
    }
    return property.floatValue;
}

bool IsMutedInHierarchy(UnityEngine.Timeline.TrackAsset track, out string mutedBy)
{
    mutedBy = null;
    var current = track;
    while (current != null)
    {
        if (current.muted)
        {
            mutedBy = current.name;
            return true;
        }
        current = current.parent as UnityEngine.Timeline.TrackAsset;
    }
    return false;
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

bool IsAudioExtension(string path)
{
    var extension = System.IO.Path.GetExtension(path).ToLowerInvariant();
    return extension == ".wav" || extension == ".mp3" || extension == ".ogg" ||
        extension == ".aif" || extension == ".aiff" || extension == ".flac" ||
        extension == ".m4a" || extension == ".aac";
}

var metadataFilePath = ExtractJsonString(parametersJson, "metadataFilePath");
var sceneName = ExtractJsonString(parametersJson, "sceneName");

// The hook runs after recording, inside the same Editor session that already
// opened and recorded this scene. Re-opening it would be a project state
// change (the payload must stay read-only, requirement 8.4) and would discard
// the very scene core just recorded, so operate on the ACTIVE scene - the same
// choice core's setup-recorder.cs / start-recording.cs make.
var scene = UnityEngine.SceneManagement.SceneManager.GetActiveScene();
if (scene.name != sceneName)
    return "{\"ok\":false,\"error\":\"Active scene is " + EscapeJson(scene.name) + " but " + EscapeJson(sceneName) + " was expected\"}";

UnityEngine.Playables.PlayableDirector rootDirector = null;
foreach (var root in scene.GetRootGameObjects())
{
    var candidate = root.GetComponent<UnityEngine.Playables.PlayableDirector>();
    if (candidate != null)
    {
        rootDirector = candidate;
        break;
    }
}

if (rootDirector == null)
    return "{\"ok\":false,\"error\":\"Root PlayableDirector not found\"}";

var rootTimeline = rootDirector.playableAsset as UnityEngine.Timeline.TimelineAsset;
if (rootTimeline == null)
    return "{\"ok\":false,\"error\":\"Root PlayableDirector has no TimelineAsset\"}";

var clips = new System.Collections.Generic.List<string>();
var warnings = new System.Collections.Generic.List<string>();
var errors = new System.Collections.Generic.List<string>();
var visited = new System.Collections.Generic.HashSet<int>();
var clipSequence = 0;

System.Action<UnityEngine.Timeline.TimelineAsset, UnityEngine.Playables.PlayableDirector, double, double, double, double, int, string> walk = null;
walk = (timeline, owner, offset, speed, windowStart, windowEnd, depth, chain) =>
{
    if (timeline == null) return;
    if (depth > 32)
    {
        warnings.Add("invalid-time-value: nesting depth limit reached at " + chain);
        return;
    }
    if (!visited.Add(timeline.GetInstanceID()))
    {
        warnings.Add("invalid-time-value: cycle detected, skipping " + chain);
        return;
    }

    foreach (var track in timeline.GetOutputTracks())
    {
        var audioTrack = track as UnityEngine.Timeline.AudioTrack;
        if (audioTrack != null)
        {
            string mutedBy;
            var trackMuted = IsMutedInHierarchy(audioTrack, out mutedBy);
            var trackPath = TrackPath(audioTrack);
            var trackVolume = ReadSerializedFloat(audioTrack, "m_TrackProperties.volume", 1f, warnings, trackPath);
            var trackClipIndex = 0;
            foreach (var clip in audioTrack.GetClips())
            {
                var asset = clip.asset as UnityEngine.Timeline.AudioPlayableAsset;
                var clipId = trackPath + "/" + clip.displayName + "#" + trackClipIndex++;
                clipSequence++;
                if (asset == null)
                {
                    warnings.Add("audio-clip-missing: " + clipId + " is not an AudioPlayableAsset");
                    continue;
                }

                var audio = asset.clip;
                if (audio == null)
                {
                    warnings.Add("audio-clip-missing: " + clipId + " has no AudioClip");
                    continue;
                }
                var assetPath = UnityEditor.AssetDatabase.GetAssetPath(audio);
                var absolutePath = string.IsNullOrEmpty(assetPath) ? null : System.IO.Path.GetFullPath(assetPath);
                var isSubAsset = UnityEditor.AssetDatabase.IsSubAsset(audio);
                if (isSubAsset)
                    errors.Add("sub-asset-source|" + clipId + "|AudioClip is a sub-asset: " + assetPath);
                else if (string.IsNullOrEmpty(assetPath) || !IsAudioExtension(assetPath) || !System.IO.File.Exists(absolutePath))
                    errors.Add("asset-path-unresolved|" + clipId + "|Audio source file is unavailable: " + (assetPath ?? audio.name));

                var clipVolume = ReadSerializedFloat(asset, "m_ClipProperties.volume", 1f, warnings, clipId);
                var clipIn = clip.clipIn;
                if (double.IsNaN(clipIn) || double.IsInfinity(clipIn) || clipIn < 0)
                {
                    warnings.Add("clip-in-clamped: " + clipId + " clipIn was clamped to 0");
                    clipIn = 0;
                }
                var rootStart = offset + clip.start / speed;
                var rootEnd = offset + (clip.start + clip.duration) / speed;
                var visibleStart = System.Math.Max(rootStart, windowStart);
                var visibleEnd = System.Math.Min(rootEnd, windowEnd);
                var effectiveSpeed = speed * clip.timeScale;
                if (double.IsNaN(rootStart) || double.IsInfinity(rootStart) ||
                    double.IsNaN(rootEnd) || double.IsInfinity(rootEnd) ||
                    double.IsNaN(effectiveSpeed) || double.IsInfinity(effectiveSpeed) || effectiveSpeed <= 0)
                {
                    warnings.Add("invalid-time-value: " + clipId + " has a non-finite or non-positive time value");
                    continue;
                }

                // 祖先 ControlClip の可視窓と重ならないクリップは通常除外する。
                // エントリを出すと rootEndSec <= rootStartSec となり、受け側スキーマの
                // `rootEndSec > rootStartSec` に反して Scene 全体の検証が失敗する。
                if (visibleEnd <= visibleStart)
                {
                    warnings.Add("outside-visible-window: " + clipId + " does not overlap its ancestor visible window");
                    continue;
                }

                // 可視窓で頭が削られた分だけ音源も進める。root 時刻 t での音源位置は
                // clipIn + (t - rootStart) * effectiveSpeed なので、開始を visibleStart に
                // 置き換えるなら clipIn も同じ換算で進めないと、ネストした Timeline の
                // 音声内容が削られた時間分だけ後ろにずれる。
                if (visibleStart > rootStart)
                    clipIn += (visibleStart - rootStart) * effectiveSpeed;

                var entry = new System.Text.StringBuilder();
                entry.Append("{\"id\":"); AppendJsonString(entry, clipId);
                entry.Append(",\"trackPath\":"); AppendJsonString(entry, trackPath);
                entry.Append(",\"sourcePath\":").Append(JsonString(absolutePath));
                entry.Append(",\"sourceSampleRate\":").Append(audio.frequency > 0 ? audio.frequency.ToString(System.Globalization.CultureInfo.InvariantCulture) : "null");
                entry.Append(",\"sourceDurationSec\":").Append(Number(audio.length));
                entry.Append(",\"rootStartSec\":").Append(Number(visibleStart));
                entry.Append(",\"rootEndSec\":").Append(Number(visibleEnd));
                entry.Append(",\"clipInSec\":").Append(Number(clipIn));
                entry.Append(",\"effectiveSpeed\":").Append(Number(effectiveSpeed));
                entry.Append(",\"clipVolume\":").Append(Number(clipVolume));
                entry.Append(",\"trackVolume\":").Append(Number(trackVolume));
                entry.Append(",\"trackMuted\":").Append(Boolean(trackMuted));
                entry.Append(",\"loop\":").Append(Boolean(asset.loop)).Append("}");
                clips.Add(entry.ToString());
            }
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
            if (childDirector == null || childTimeline == null)
            {
                warnings.Add("control-clip-unresolved: ControlClip target has no PlayableDirector Timeline: " + target.name);
                continue;
            }
            var rootStart = offset + clip.start / speed;
            var rootEnd = offset + (clip.start + clip.duration) / speed;
            var childSpeed = speed * clip.timeScale;
            if (childSpeed <= 0 || double.IsNaN(childSpeed) || double.IsInfinity(childSpeed))
            {
                warnings.Add("invalid-time-value: invalid ControlClip timeScale at " + clip.displayName);
                continue;
            }
            var childOffset = rootStart - clip.clipIn / childSpeed;
            walk(childTimeline, childDirector, childOffset, childSpeed,
                System.Math.Max(windowStart, rootStart), System.Math.Min(windowEnd, rootEnd),
                depth + 1, chain + " > " + clip.displayName);
        }
    }
    visited.Remove(timeline.GetInstanceID());
};

walk(rootTimeline, rootDirector, 0, 1, 0, double.MaxValue, 0, "root");

var output = new System.Text.StringBuilder();
output.Append("{\"schemaVersion\":1,\"sceneName\":"); AppendJsonString(output, sceneName);
output.Append(",\"extractedAt\":"); AppendJsonString(output, System.DateTime.UtcNow.ToString("o", System.Globalization.CultureInfo.InvariantCulture));
output.Append(",\"clips\":[").Append(string.Join(",", clips.ToArray())).Append("],\"errors\":[");
for (var i = 0; i < errors.Count; i++)
{
    if (i > 0) output.Append(",");
    var parts = errors[i].Split(new[] { '|' }, 3);
    output.Append("{\"kind\":"); AppendJsonString(output, parts[0]);
    output.Append(",\"clipId\":"); AppendJsonString(output, parts[1]);
    // AppendJsonString is a local function returning void, so it cannot be chained.
    output.Append(",\"detail\":"); AppendJsonString(output, parts[2]); output.Append("}");
}
output.Append("],\"warnings\":[");
for (var i = 0; i < warnings.Count; i++)
{
    if (i > 0) output.Append(",");
    var separator = warnings[i].IndexOf(": ", System.StringComparison.Ordinal);
    var kind = separator > 0 ? warnings[i].Substring(0, separator) : "invalid-time-value";
    var detail = separator > 0 ? warnings[i].Substring(separator + 2) : warnings[i];
    var clipId = detail;
    var space = detail.IndexOf(' ');
    if (space > 0) clipId = detail.Substring(0, space);
    output.Append("{\"kind\":"); AppendJsonString(output, kind);
    output.Append(",\"clipId\":"); AppendJsonString(output, clipId);
    output.Append(",\"detail\":"); AppendJsonString(output, detail); output.Append("}");
}
output.Append("]}");

var temporaryPath = metadataFilePath + ".tmp";
System.IO.File.WriteAllText(temporaryPath, output.ToString(), new System.Text.UTF8Encoding(false));
if (System.IO.File.Exists(metadataFilePath))
    System.IO.File.Replace(temporaryPath, metadataFilePath, null);
else
    System.IO.File.Move(temporaryPath, metadataFilePath);

return "{\"ok\":true,\"clipCount\":" + clips.Count + ",\"errorCount\":" + errors.Count + ",\"warningCount\":" + warnings.Count + "}";

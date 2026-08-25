// Unity eval payload: read the spike fixtures back the way the extraction
// payload will have to, and dump everything as JSON.
//
// Sent with:  unity command eval_file --project-path <spike/unity-project> <this file> --timeout 180
//
// This is the read-back proof for the generated fixtures and the first
// measurement of spike questions Q-1..Q-5 and Q-10:
//   Q-1  enumerate AudioTracks across GroupTrack + nested ControlTrack levels
//   Q-2  TimelineClip / AudioPlayableAsset attribute values
//   Q-3  clip volume  (no public API -> SerializedObject)
//   Q-4  track volume + hierarchical mute
//   Q-5  original file path via AssetDatabase.GetAssetPath
//   Q-10 root-absolute start time and effective speed under nesting
//
// Time model, applied per nesting level:
//   root_time = offset + local_time / speed
//   for a ControlClip at local start S, clipIn cin, timeScale TS in a timeline
//   with (offset, speed):
//     R_S    = offset + S / speed
//     speed' = speed * TS
//     offset'= R_S - cin / speed'
//   the child is only audible while root_time is inside [R_S, R_S + dur/speed].

string EscapeJson(string value)
{
    if (value == null) return "";
    return value.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n");
}
string Num(double v)
{
    if (double.IsNaN(v) || double.IsInfinity(v)) return "null";
    return v.ToString("R", System.Globalization.CultureInfo.InvariantCulture);
}
string B(bool v) { return v ? "true" : "false"; }

float ReadSerializedFloat(UnityEngine.Object target, string path, float fallback)
{
    if (target == null) return fallback;
    var so = new UnityEditor.SerializedObject(target);
    var p = so.FindProperty(path);
    return p == null ? fallback : p.floatValue;
}

var clips = new System.Collections.Generic.List<string>();
var warnings = new System.Collections.Generic.List<string>();
var errors = new System.Collections.Generic.List<string>();

// --------------------------------------------------------------- open scene

var scenePath = "Assets/Scenes/AudioSpike.unity";
var scene = UnityEditor.SceneManagement.EditorSceneManager.OpenScene(
    scenePath, UnityEditor.SceneManagement.OpenSceneMode.Single);

UnityEngine.Playables.PlayableDirector rootDirector = null;
foreach (var go in scene.GetRootGameObjects())
{
    if (go.name != "Root") continue;
    rootDirector = go.GetComponent<UnityEngine.Playables.PlayableDirector>();
}
if (rootDirector == null)
    return "{\"ok\":false,\"error\":\"Root PlayableDirector not found in " + EscapeJson(scenePath) + "\"}";

var rootTimeline = rootDirector.playableAsset as UnityEngine.Timeline.TimelineAsset;
if (rootTimeline == null)
    return "{\"ok\":false,\"error\":\"Root director has no TimelineAsset\"}";

// ------------------------------------------------------- hierarchical helpers

// A track is silent if it, or any GroupTrack above it, is muted.
bool IsMutedInHierarchy(UnityEngine.Timeline.TrackAsset track, out string mutedBy)
{
    mutedBy = null;
    var t = track;
    while (t != null)
    {
        if (t.muted) { mutedBy = t.name; return true; }
        t = t.parent as UnityEngine.Timeline.TrackAsset;
    }
    return false;
}

string TrackPath(UnityEngine.Timeline.TrackAsset track)
{
    var parts = new System.Collections.Generic.List<string>();
    var t = track;
    while (t != null)
    {
        parts.Insert(0, t.name);
        t = t.parent as UnityEngine.Timeline.TrackAsset;
    }
    return string.Join("/", parts.ToArray());
}

// ----------------------------------------------------------------- traversal

var visited = new System.Collections.Generic.HashSet<int>();

System.Action<UnityEngine.Timeline.TimelineAsset, UnityEngine.Playables.PlayableDirector, double, double, double, double, int, string> walk = null;
walk = (timeline, owner, offset, speed, windowStart, windowEnd, depth, chain) =>
{
    if (timeline == null) return;
    if (depth > 8) { warnings.Add("nesting depth limit reached at " + chain); return; }
    if (!visited.Add(timeline.GetInstanceID()))
    {
        warnings.Add("cycle detected, skipping re-entry into " + timeline.name + " at " + chain);
        return;
    }

    foreach (var track in timeline.GetOutputTracks())
    {
        var audioTrack = track as UnityEngine.Timeline.AudioTrack;
        if (audioTrack != null)
        {
            string mutedBy;
            var muted = IsMutedInHierarchy(audioTrack, out mutedBy);
            var trackVolume = ReadSerializedFloat(audioTrack, "m_TrackProperties.volume", 1f);

            foreach (var clip in audioTrack.GetClips())
            {
                var asset = clip.asset as UnityEngine.Timeline.AudioPlayableAsset;
                if (asset == null) { warnings.Add("non-audio clip on AudioTrack: " + TrackPath(audioTrack)); continue; }

                var audio = asset.clip;
                var assetPath = audio == null ? null : UnityEditor.AssetDatabase.GetAssetPath(audio);
                string absPath = null;
                var hasFile = false;
                if (!string.IsNullOrEmpty(assetPath))
                {
                    absPath = System.IO.Path.GetFullPath(assetPath);
                    hasFile = System.IO.File.Exists(absPath);
                    if (!hasFile)
                        errors.Add("audio asset has no file on disk (sub-asset?): " + assetPath);
                }
                else if (audio != null)
                {
                    errors.Add("audio clip has no asset path: " + audio.name);
                }
                else
                {
                    errors.Add("audio clip missing on " + TrackPath(audioTrack));
                }

                var clipVolume = ReadSerializedFloat(asset, "m_ClipProperties.volume", 1f);
                var effectiveSpeed = speed * clip.timeScale;
                var rootStart = offset + clip.start / speed;
                var rootEnd = offset + (clip.start + clip.duration) / speed;
                // clamp to the ancestor visibility window
                var visStart = System.Math.Max(rootStart, windowStart);
                var visEnd = System.Math.Min(rootEnd, windowEnd);
                var clampedHead = visStart > rootStart;
                var clampedTail = visEnd < rootEnd;

                var sb = new System.Text.StringBuilder();
                sb.Append("{\"chain\":\"").Append(EscapeJson(chain)).Append("\"");
                sb.Append(",\"depth\":").Append(depth);
                sb.Append(",\"track\":\"").Append(EscapeJson(TrackPath(audioTrack))).Append("\"");
                sb.Append(",\"clip\":\"").Append(EscapeJson(clip.displayName)).Append("\"");
                sb.Append(",\"assetPath\":").Append(assetPath == null ? "null" : "\"" + EscapeJson(assetPath) + "\"");
                sb.Append(",\"absolutePath\":").Append(absPath == null ? "null" : "\"" + EscapeJson(absPath) + "\"");
                sb.Append(",\"fileExists\":").Append(B(hasFile));
                sb.Append(",\"sourceLengthSec\":").Append(audio == null ? "null" : Num(audio.length));
                sb.Append(",\"sourceChannels\":").Append(audio == null ? "null" : audio.channels.ToString());
                sb.Append(",\"sourceFrequency\":").Append(audio == null ? "null" : audio.frequency.ToString());
                sb.Append(",\"localStart\":").Append(Num(clip.start));
                sb.Append(",\"localDuration\":").Append(Num(clip.duration));
                sb.Append(",\"clipIn\":").Append(Num(clip.clipIn));
                sb.Append(",\"clipTimeScale\":").Append(Num(clip.timeScale));
                sb.Append(",\"loop\":").Append(B(asset.loop));
                sb.Append(",\"clipVolume\":").Append(Num(clipVolume));
                sb.Append(",\"trackVolume\":").Append(Num(trackVolume));
                sb.Append(",\"muted\":").Append(B(muted));
                sb.Append(",\"mutedBy\":").Append(mutedBy == null ? "null" : "\"" + EscapeJson(mutedBy) + "\"");
                sb.Append(",\"rootStartSec\":").Append(Num(rootStart));
                sb.Append(",\"rootEndSec\":").Append(Num(rootEnd));
                sb.Append(",\"visibleStartSec\":").Append(Num(visStart));
                sb.Append(",\"visibleEndSec\":").Append(Num(visEnd));
                sb.Append(",\"clampedHead\":").Append(B(clampedHead));
                sb.Append(",\"clampedTail\":").Append(B(clampedTail));
                sb.Append(",\"effectiveSpeed\":").Append(Num(effectiveSpeed));
                sb.Append("}");
                clips.Add(sb.ToString());
            }
            continue;
        }

        var controlTrack = track as UnityEngine.Timeline.ControlTrack;
        if (controlTrack == null) continue;

        foreach (var clip in controlTrack.GetClips())
        {
            var cpa = clip.asset as UnityEngine.Timeline.ControlPlayableAsset;
            if (cpa == null) continue;

            var target = cpa.sourceGameObject.Resolve(owner);
            if (target == null)
            {
                warnings.Add("unresolved ControlClip reference, skipping subtree: "
                    + chain + " -> " + TrackPath(controlTrack) + "/" + clip.displayName);
                continue;
            }
            var childDirector = target.GetComponent<UnityEngine.Playables.PlayableDirector>();
            if (childDirector == null)
            {
                warnings.Add("ControlClip target has no PlayableDirector: " + target.name);
                continue;
            }
            var childTimeline = childDirector.playableAsset as UnityEngine.Timeline.TimelineAsset;
            if (childTimeline == null)
            {
                warnings.Add("ControlClip director has no TimelineAsset: " + target.name);
                continue;
            }

            var rs = offset + clip.start / speed;
            var re = offset + (clip.start + clip.duration) / speed;
            var childSpeed = speed * clip.timeScale;
            var childOffset = rs - clip.clipIn / childSpeed;

            walk(childTimeline, childDirector, childOffset, childSpeed,
                System.Math.Max(windowStart, rs), System.Math.Min(windowEnd, re),
                depth + 1, chain + " > " + clip.displayName);
        }
    }

    visited.Remove(timeline.GetInstanceID());
};

walk(rootTimeline, rootDirector, 0.0, 1.0, 0.0, double.MaxValue, 0, "root");

// Confirm the decoy scene AudioSource is present but was never traversed.
var decoyPresent = false;
foreach (var go in scene.GetRootGameObjects())
    if (go.GetComponent<UnityEngine.AudioSource>() != null) decoyPresent = true;

var outSb = new System.Text.StringBuilder();
outSb.Append("{\"ok\":true");
outSb.Append(",\"rootDurationSec\":").Append(Num(rootTimeline.duration));
outSb.Append(",\"fps\":").Append(Num(rootTimeline.editorSettings.fps));
outSb.Append(",\"decoyAudioSourceInScene\":").Append(B(decoyPresent));
outSb.Append(",\"clipCount\":").Append(clips.Count);
outSb.Append(",\"clips\":[").Append(string.Join(",", clips.ToArray())).Append("]");
outSb.Append(",\"warnings\":[");
for (var i = 0; i < warnings.Count; i++)
{
    if (i > 0) outSb.Append(",");
    outSb.Append("\"").Append(EscapeJson(warnings[i])).Append("\"");
}
outSb.Append("],\"errors\":[");
for (var i = 0; i < errors.Count; i++)
{
    if (i > 0) outSb.Append(",");
    outSb.Append("\"").Append(EscapeJson(errors[i])).Append("\"");
}
outSb.Append("]}");
return outSb.ToString();

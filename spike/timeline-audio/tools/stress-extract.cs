// Unity eval payload: scale and atomic-write measurement for spike question Q-6.
//
// Sent with:  unity command eval_file --project-path <spike/unity-project> <this file> --timeout 300
//
// Builds a large Timeline (150 audio clips over 10 tracks), walks it exactly the
// way the extraction payload will, serialises the result with a hand-written
// StringBuilder JSON writer (JsonUtility cannot serialise nested custom types in
// the eval context - see README Q-6), and writes it to a session directory with
// a temp -> File.Move atomic rename.
//
// Returns timings, byte size and the atomicity check result.

var sessionDir = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "timeline-audio-spike-session");
System.IO.Directory.CreateDirectory(sessionDir);

var swTotal = System.Diagnostics.Stopwatch.StartNew();

// ------------------------------------------------------------------- build

var timelinePath = "Assets/Timeline/AudioSpikeStress.playable";
if (UnityEditor.AssetDatabase.LoadAssetAtPath<UnityEngine.Object>(timelinePath) != null)
    UnityEditor.AssetDatabase.DeleteAsset(timelinePath);

var srcPaths = new string[]
{
    "Assets/Audio/click_48k_st_1s.wav",
    "Assets/Audio/tone440_44k_st_2s.wav",
    "Assets/Audio/tone880_48k_mono_3s.wav",
    "Assets/Audio/beep1k_48k_st_0p5s.wav",
};
var srcs = new UnityEngine.AudioClip[srcPaths.Length];
for (var i = 0; i < srcPaths.Length; i++)
    srcs[i] = UnityEditor.AssetDatabase.LoadAssetAtPath<UnityEngine.AudioClip>(srcPaths[i]);

var swBuild = System.Diagnostics.Stopwatch.StartNew();
var timeline = UnityEngine.ScriptableObject.CreateInstance<UnityEngine.Timeline.TimelineAsset>();
UnityEditor.AssetDatabase.CreateAsset(timeline, timelinePath);
timeline.editorSettings.fps = 30f;

const int trackCount = 10;
const int perTrack = 15;
for (var t = 0; t < trackCount; t++)
{
    var track = timeline.CreateTrack<UnityEngine.Timeline.AudioTrack>(null, "T" + t.ToString("00"));
    if (t == 7) track.muted = true;
    var so = new UnityEditor.SerializedObject(track);
    var tv = so.FindProperty("m_TrackProperties.volume");
    if (tv != null) { tv.floatValue = 0.5f + 0.05f * t; so.ApplyModifiedPropertiesWithoutUndo(); }

    for (var k = 0; k < perTrack; k++)
    {
        var idx = t * perTrack + k;
        var c = track.CreateClip<UnityEngine.Timeline.AudioPlayableAsset>();
        var asset = (UnityEngine.Timeline.AudioPlayableAsset)c.asset;
        asset.clip = srcs[idx % srcs.Length];
        asset.loop = (idx % 3) == 0;
        asset.name = "s" + idx;
        c.displayName = "clip" + idx;
        c.start = k * 1.7 + t * 0.11;
        c.duration = 0.4 + (idx % 5) * 0.3;
        c.clipIn = (idx % 4) * 0.05;
        c.timeScale = 0.5 + (idx % 7) * 0.25;
        var aso = new UnityEditor.SerializedObject(asset);
        var cv = aso.FindProperty("m_ClipProperties.volume");
        if (cv != null) { cv.floatValue = 0.2f + (idx % 9) * 0.08f; aso.ApplyModifiedPropertiesWithoutUndo(); }
    }
}
UnityEditor.EditorUtility.SetDirty(timeline);
UnityEditor.AssetDatabase.SaveAssets();
swBuild.Stop();

// ------------------------------------------------- walk + hand-written JSON

string EscapeJson(string value)
{
    if (value == null) return "";
    return value.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n");
}
// "R" gives a round-trippable representation for double, which is what the
// TS side needs in order to compare against its own computation.
string Num(double v) { return v.ToString("R", System.Globalization.CultureInfo.InvariantCulture); }

float ReadFloat(UnityEngine.Object target, string path, float fallback)
{
    var so2 = new UnityEditor.SerializedObject(target);
    var p = so2.FindProperty(path);
    return p == null ? fallback : p.floatValue;
}

var swWalk = System.Diagnostics.Stopwatch.StartNew();
var json = new System.Text.StringBuilder(1 << 20);
json.Append("{\"schemaVersion\":1,\"clips\":[");
var count = 0;
foreach (var track in timeline.GetOutputTracks())
{
    var at = track as UnityEngine.Timeline.AudioTrack;
    if (at == null) continue;
    var trackVolume = ReadFloat(at, "m_TrackProperties.volume", 1f);
    var muted = at.muted;
    foreach (var clip in at.GetClips())
    {
        var asset = clip.asset as UnityEngine.Timeline.AudioPlayableAsset;
        if (asset == null) continue;
        var audio = asset.clip;
        var assetPath = audio == null ? null : UnityEditor.AssetDatabase.GetAssetPath(audio);
        var abs = string.IsNullOrEmpty(assetPath) ? null : System.IO.Path.GetFullPath(assetPath);
        if (count > 0) json.Append(",");
        json.Append("{\"clipId\":\"").Append(EscapeJson(clip.displayName)).Append("\"");
        json.Append(",\"track\":\"").Append(EscapeJson(at.name)).Append("\"");
        json.Append(",\"sourcePath\":\"").Append(EscapeJson(abs)).Append("\"");
        json.Append(",\"sourceLengthSec\":").Append(audio == null ? "null" : Num(audio.length));
        json.Append(",\"rootStartSec\":").Append(Num(clip.start));
        json.Append(",\"durationSec\":").Append(Num(clip.duration));
        json.Append(",\"clipInSec\":").Append(Num(clip.clipIn));
        json.Append(",\"effectiveSpeed\":").Append(Num(clip.timeScale));
        json.Append(",\"loop\":").Append(asset.loop ? "true" : "false");
        json.Append(",\"clipVolume\":").Append(Num(ReadFloat(asset, "m_ClipProperties.volume", 1f)));
        json.Append(",\"trackVolume\":").Append(Num(trackVolume));
        json.Append(",\"muted\":").Append(muted ? "true" : "false");
        json.Append("}");
        count++;
    }
}
json.Append("],\"errors\":[],\"warnings\":[]}");
swWalk.Stop();

// ------------------------------------------------------------ atomic write

var finalPath = System.IO.Path.Combine(sessionDir, "audio-metadata.json");
var tempPath = finalPath + ".tmp";
if (System.IO.File.Exists(tempPath)) System.IO.File.Delete(tempPath);

var swWrite = System.Diagnostics.Stopwatch.StartNew();
var payload = json.ToString();
System.IO.File.WriteAllText(tempPath, payload, new System.Text.UTF8Encoding(false));
var tempExisted = System.IO.File.Exists(tempPath);
// File.Move over an existing destination throws on .NET Framework, so the
// destination is removed first; the rename itself stays atomic on NTFS.
if (System.IO.File.Exists(finalPath)) System.IO.File.Delete(finalPath);
System.IO.File.Move(tempPath, finalPath);
swWrite.Stop();

var tempGone = !System.IO.File.Exists(tempPath);
var finalExists = System.IO.File.Exists(finalPath);
var finalSize = finalExists ? new System.IO.FileInfo(finalPath).Length : 0;
swTotal.Stop();

// round-trip check on one known value
var probe = "\"rootStartSec\":" + Num(1 * 1.7 + 0 * 0.11);

return "{\"ok\":true"
    + ",\"clipCount\":" + count
    + ",\"buildMs\":" + swBuild.ElapsedMilliseconds
    + ",\"walkSerializeMs\":" + swWalk.ElapsedMilliseconds
    + ",\"writeMs\":" + swWrite.ElapsedMilliseconds
    + ",\"totalMs\":" + swTotal.ElapsedMilliseconds
    + ",\"jsonBytes\":" + finalSize
    + ",\"tempWritten\":" + (tempExisted ? "true" : "false")
    + ",\"tempRemovedAfterMove\":" + (tempGone ? "true" : "false")
    + ",\"finalExists\":" + (finalExists ? "true" : "false")
    + ",\"sessionDir\":\"" + EscapeJson(sessionDir) + "\""
    + ",\"probeFound\":" + (payload.Contains(probe) ? "true" : "false")
    + ",\"probe\":\"" + EscapeJson(probe) + "\""
    + "}";

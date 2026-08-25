// Unity eval payload: source-format coverage for spike question Q-5.
//
// Sent with:  unity command eval_file --project-path <spike/unity-project> <this file> --timeout 180
//
// The main fixture (build-fixtures.cs) only uses .wav under Assets/. Q-5 also
// needs .mp3 / .ogg, an asset that lives inside a package (Packages/... path
// form) and a reference with no standalone file on disk (sub-asset), so that
// the extraction payload's path resolution and error recording can be pinned
// down.
//
// Creates:
//   Assets/Audio/SubAssetContainer.asset   (holds a generated AudioClip sub-asset)
//   Assets/Timeline/AudioSpikeSources.playable
//   Assets/Scenes/AudioSpikeSources.unity
//
// Returns, for every referenced AudioClip: the AssetDatabase path, the resolved
// absolute path, whether a file actually exists there, and IsSubAsset / IsMainAsset.

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
string Q(string s) { return s == null ? "null" : "\"" + EscapeJson(s) + "\""; }

UnityEditor.AssetDatabase.Refresh();

var containerPath = "Assets/Audio/SubAssetContainer.asset";
var timelinePath = "Assets/Timeline/AudioSpikeSources.playable";
var scenePath = "Assets/Scenes/AudioSpikeSources.unity";

foreach (var p in new string[] { containerPath, timelinePath, scenePath })
{
    if (UnityEditor.AssetDatabase.LoadAssetAtPath<UnityEngine.Object>(p) != null)
        UnityEditor.AssetDatabase.DeleteAsset(p);
}

// ------------------------------------------- sub-asset AudioClip (no own file)

// A procedurally created AudioClip stored inside a .asset container: the
// reference resolves, but GetAssetPath points at a .asset file, not an audio
// file. This is the "no file on disk" case the extractor must record as error.
var container = UnityEngine.ScriptableObject.CreateInstance<UnityEngine.ScriptableObject>();
UnityEditor.AssetDatabase.CreateAsset(container, containerPath);

var subClip = UnityEngine.AudioClip.Create("GeneratedSubAssetClip", 24000, 2, 48000, false);
var samples = new float[24000 * 2];
for (var i = 0; i < 24000; i++)
{
    var v = (float)(System.Math.Sin(2.0 * System.Math.PI * 600.0 * i / 48000.0) * 0.4);
    samples[i * 2] = v;
    samples[i * 2 + 1] = v;
}
subClip.SetData(samples, 0);
UnityEditor.AssetDatabase.AddObjectToAsset(subClip, container);

// -------------------------------------------------------------- load sources

var sources = new System.Collections.Generic.List<UnityEngine.AudioClip>();
var labels = new System.Collections.Generic.List<string>();

void Add(string label, string path)
{
    var c = UnityEditor.AssetDatabase.LoadAssetAtPath<UnityEngine.AudioClip>(path);
    labels.Add(label);
    sources.Add(c);
}
Add("wav (Assets)", "Assets/Audio/click_48k_st_1s.wav");
Add("mp3 (Assets)", "Assets/Audio/tone440_44k_st_2s.mp3");
Add("ogg (Assets)", "Assets/Audio/tone880_48k_mono_3s.ogg");
Add("wav (Packages, embedded)", "Packages/com.spike.audio/Runtime/Audio/pkg_beep_0p5s.wav");
labels.Add("AudioClip sub-asset (no file)");
sources.Add(subClip);

// ------------------------------------------------------------ scene first (1)

var scene = UnityEditor.SceneManagement.EditorSceneManager.NewScene(
    UnityEditor.SceneManagement.NewSceneSetup.EmptyScene,
    UnityEditor.SceneManagement.NewSceneMode.Single);
var go = new UnityEngine.GameObject("SourcesRoot");
var director = go.AddComponent<UnityEngine.Playables.PlayableDirector>();
director.playOnAwake = false;

// ---------------------------------------------------------- timeline next (2)

var timeline = UnityEngine.ScriptableObject.CreateInstance<UnityEngine.Timeline.TimelineAsset>();
UnityEditor.AssetDatabase.CreateAsset(timeline, timelinePath);
timeline.editorSettings.fps = 30f;

var start = 0.0;
for (var i = 0; i < sources.Count; i++)
{
    var track = timeline.CreateTrack<UnityEngine.Timeline.AudioTrack>(null, "S" + i + "_" + labels[i].Replace(" ", "_").Replace("(", "").Replace(")", "").Replace(",", ""));
    var c = track.CreateClip<UnityEngine.Timeline.AudioPlayableAsset>();
    var asset = (UnityEngine.Timeline.AudioPlayableAsset)c.asset;
    asset.clip = sources[i];
    asset.name = "src" + i;
    c.displayName = labels[i];
    c.start = start;
    c.duration = 0.5;
    start += 1.0;
}
director.playableAsset = timeline;

// ------------------------------------------------------------------ save (3)

UnityEditor.EditorUtility.SetDirty(timeline);
UnityEditor.EditorUtility.SetDirty(container);
UnityEditor.EditorUtility.SetDirty(director);
UnityEditor.SceneManagement.EditorSceneManager.MarkSceneDirty(scene);
UnityEditor.SceneManagement.EditorSceneManager.SaveScene(scene, scenePath);
UnityEditor.AssetDatabase.SaveAssets();

// -------------------------------------------------------------- report Q-5

var sb = new System.Text.StringBuilder();
sb.Append("{\"ok\":true,\"sources\":[");
for (var i = 0; i < sources.Count; i++)
{
    if (i > 0) sb.Append(",");
    var c = sources[i];
    string assetPath = null, absPath = null, ext = null;
    var exists = false;
    var isSub = false;
    var isMain = false;
    if (c != null)
    {
        assetPath = UnityEditor.AssetDatabase.GetAssetPath(c);
        isSub = UnityEditor.AssetDatabase.IsSubAsset(c);
        isMain = UnityEditor.AssetDatabase.IsMainAsset(c);
        if (!string.IsNullOrEmpty(assetPath))
        {
            ext = System.IO.Path.GetExtension(assetPath).ToLowerInvariant();
            // Path.GetFullPath resolves both "Assets/..." and "Packages/..." forms
            // relative to the project root (the Editor's working directory).
            absPath = System.IO.Path.GetFullPath(assetPath);
            exists = System.IO.File.Exists(absPath);
        }
    }
    // An audio-bearing file is required; a .asset container is not one.
    var isAudioFile = ext == ".wav" || ext == ".mp3" || ext == ".ogg" || ext == ".aiff" || ext == ".aif";
    sb.Append("{\"label\":").Append(Q(labels[i]));
    sb.Append(",\"loaded\":").Append(B(c != null));
    sb.Append(",\"assetPath\":").Append(Q(assetPath));
    sb.Append(",\"absolutePath\":").Append(Q(absPath));
    sb.Append(",\"extension\":").Append(Q(ext));
    sb.Append(",\"fileExists\":").Append(B(exists));
    sb.Append(",\"isAudioFileExtension\":").Append(B(isAudioFile));
    sb.Append(",\"isSubAsset\":").Append(B(isSub));
    sb.Append(",\"isMainAsset\":").Append(B(isMain));
    sb.Append(",\"lengthSec\":").Append(c == null ? "null" : Num(c.length));
    sb.Append(",\"channels\":").Append(c == null ? "null" : c.channels.ToString());
    sb.Append(",\"frequency\":").Append(c == null ? "null" : c.frequency.ToString());
    sb.Append("}");
}
sb.Append("],\"projectRoot\":").Append(Q(System.IO.Directory.GetCurrentDirectory()));
sb.Append("}");
return sb.ToString();

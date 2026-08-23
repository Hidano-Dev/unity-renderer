// Unity eval payload: build the Timeline fixtures for the timeline-audio-remux spike.
//
// Sent with:  unity command eval_file --project-path <spike/unity-project> <this file> --timeout 180
//
// Creates (idempotent - deletes and rebuilds):
//   Assets/Timeline/AudioSpikeNestedL2.playable
//   Assets/Timeline/AudioSpikeNestedL1.playable
//   Assets/Timeline/AudioSpikeRoot.playable
//   Assets/Scenes/AudioSpike.unity
//
// Ordering matters: an AssetDatabase.SaveAssets()/Refresh() in the middle
// reimports the dirty .playable files, which destroys the in-memory track and
// clip sub-assets we are still holding. So the scene and its PlayableDirectors
// are created FIRST (ControlPlayableAsset exposed references need a director to
// register against) and everything is saved exactly once at the end.
//
// Returns a JSON summary describing every track/clip it created plus the
// serialized property paths that actually resolved for clip/track volume
// (first measurement input for spike questions Q-3 / Q-4).

var notes = new System.Collections.Generic.List<string>();

string EscapeJson(string value)
{
    if (value == null) return "";
    return value.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n");
}
string Num(double v)
{
    return v.ToString("R", System.Globalization.CultureInfo.InvariantCulture);
}

// ---------------------------------------------------------------- audio clips

UnityEngine.AudioClip LoadClip(string path)
{
    var c = UnityEditor.AssetDatabase.LoadAssetAtPath<UnityEngine.AudioClip>(path);
    if (c == null) throw new System.InvalidOperationException("Missing audio fixture: " + path);
    return c;
}

var clipClick = LoadClip("Assets/Audio/click_48k_st_1s.wav");
var clipTone440 = LoadClip("Assets/Audio/tone440_44k_st_2s.wav");
var clipTone880 = LoadClip("Assets/Audio/tone880_48k_mono_3s.wav");
var clipBeep = LoadClip("Assets/Audio/beep1k_48k_st_0p5s.wav");

// ------------------------------------------------------- serialized accessors

// Clip volume and track volume have no public API in Timeline 1.7; the spike
// needs to know which serialized path works. Try the known candidates and
// record which one resolved.
var volumePathsUsed = new System.Collections.Generic.Dictionary<string, string>();

bool TrySetSerializedFloat(UnityEngine.Object target, string[] candidates, float value, string label)
{
    var so = new UnityEditor.SerializedObject(target);
    foreach (var path in candidates)
    {
        var prop = so.FindProperty(path);
        if (prop == null) continue;
        prop.floatValue = value;
        so.ApplyModifiedPropertiesWithoutUndo();
        if (!volumePathsUsed.ContainsKey(label)) volumePathsUsed[label] = path;
        return true;
    }
    if (!volumePathsUsed.ContainsKey(label)) volumePathsUsed[label] = "(unresolved)";
    notes.Add("volume path unresolved for " + label + " on " + target.GetType().FullName);
    return false;
}

var clipVolumeCandidates = new string[] { "m_ClipProperties.volume", "m_ClipCaps.volume", "m_Volume" };
var trackVolumeCandidates = new string[] { "m_TrackProperties.volume", "m_Volume" };

// ----------------------------------------------------------- paths / cleanup

var rootPath = "Assets/Timeline/AudioSpikeRoot.playable";
var l1Path = "Assets/Timeline/AudioSpikeNestedL1.playable";
var l2Path = "Assets/Timeline/AudioSpikeNestedL2.playable";
var scenePath = "Assets/Scenes/AudioSpike.unity";

void EnsureFolder(string parent, string leaf)
{
    if (!UnityEditor.AssetDatabase.IsValidFolder(parent + "/" + leaf))
        UnityEditor.AssetDatabase.CreateFolder(parent, leaf);
}
EnsureFolder("Assets", "Timeline");
EnsureFolder("Assets", "Scenes");

// Delete every previous artifact up front, so no reimport happens mid-build.
foreach (var p in new string[] { rootPath, l1Path, l2Path, scenePath })
{
    if (UnityEditor.AssetDatabase.LoadAssetAtPath<UnityEngine.Object>(p) != null)
        UnityEditor.AssetDatabase.DeleteAsset(p);
}

// ---------------------------------------------------- scene and directors (1)

var scene = UnityEditor.SceneManagement.EditorSceneManager.NewScene(
    UnityEditor.SceneManagement.NewSceneSetup.EmptyScene,
    UnityEditor.SceneManagement.NewSceneMode.Single);

UnityEngine.Playables.PlayableDirector MakeDirector(string goName)
{
    var go = new UnityEngine.GameObject(goName);
    var d = go.AddComponent<UnityEngine.Playables.PlayableDirector>();
    d.playOnAwake = false;
    return d;
}

var rootDirector = MakeDirector("Root");
var l1Director = MakeDirector("NestedL1");
var l2Director = MakeDirector("NestedL2");

// An AudioListener is required for anything to reach Unity's audio output, and
// therefore for Recorder's AudioRecorderSettings to capture the reference mix
// (Q-7 / Q-10 / Q-11). The camera is only there so the scene is also usable for
// a video capture pass (Q-9).
var camGo = new UnityEngine.GameObject("MainCamera");
camGo.tag = "MainCamera";
var cam = camGo.AddComponent<UnityEngine.Camera>();
cam.clearFlags = UnityEngine.CameraClearFlags.SolidColor;
cam.backgroundColor = new UnityEngine.Color(0.1f, 0.1f, 0.15f, 1f);
camGo.AddComponent<UnityEngine.AudioListener>();

// Decoy: a plain scene AudioSource that the extractor must NOT pick up
// (requirement 1.x - scanning starts from the TimelineAsset, not the scene).
var decoy = new UnityEngine.GameObject("DecoyAudioSource");
var decoySource = decoy.AddComponent<UnityEngine.AudioSource>();
decoySource.clip = clipTone880;
decoySource.playOnAwake = false;

// -------------------------------------------------------------- timelines (2)

UnityEngine.Timeline.TimelineAsset NewTimeline(string path, float fps)
{
    var t = UnityEngine.ScriptableObject.CreateInstance<UnityEngine.Timeline.TimelineAsset>();
    UnityEditor.AssetDatabase.CreateAsset(t, path);
    var settings = t.editorSettings;
    settings.fps = fps;
    return t;
}

// Records what we built so the JSON summary doubles as the expected-value table.
var rows = new System.Collections.Generic.List<string>();
void Row(string timeline, string track, string clipName, double start, double duration, double clipIn, double timeScale, bool loop, bool muted)
{
    rows.Add("{\"timeline\":\"" + EscapeJson(timeline) + "\",\"track\":\"" + EscapeJson(track)
        + "\",\"clip\":\"" + EscapeJson(clipName) + "\",\"start\":" + Num(start)
        + ",\"duration\":" + Num(duration) + ",\"clipIn\":" + Num(clipIn)
        + ",\"timeScale\":" + Num(timeScale) + ",\"loop\":" + (loop ? "true" : "false")
        + ",\"trackMuted\":" + (muted ? "true" : "false") + "}");
}

UnityEngine.Timeline.TimelineClip AddAudio(
    string timelineName,
    UnityEngine.Timeline.AudioTrack track,
    UnityEngine.AudioClip audio,
    double start, double duration, double clipIn, double timeScale, bool loop, float clipVolume)
{
    var c = track.CreateClip<UnityEngine.Timeline.AudioPlayableAsset>();
    var asset = (UnityEngine.Timeline.AudioPlayableAsset)c.asset;
    asset.clip = audio;
    asset.loop = loop;
    asset.name = audio.name + "_asset";
    c.displayName = audio.name;
    c.start = start;
    c.duration = duration;
    c.clipIn = clipIn;
    c.timeScale = timeScale;
    if (clipVolume >= 0f)
        TrySetSerializedFloat(asset, clipVolumeCandidates, clipVolume, "clipVolume");
    UnityEditor.EditorUtility.SetDirty(asset);
    Row(timelineName, track.name, c.displayName, start, duration, clipIn, timeScale, loop, track.muted);
    return c;
}

var controlRows = new System.Collections.Generic.List<string>();

UnityEngine.Timeline.TimelineClip AddControl(
    UnityEngine.Timeline.ControlTrack track,
    UnityEngine.Playables.PlayableDirector owner,
    UnityEngine.GameObject target,          // null => deliberately broken reference
    string label,
    double start, double duration, double timeScale)
{
    var c = track.CreateClip<UnityEngine.Timeline.ControlPlayableAsset>();
    var asset = (UnityEngine.Timeline.ControlPlayableAsset)c.asset;
    asset.updateDirector = true;
    asset.updateParticle = false;
    asset.searchHierarchy = false;
    asset.active = true;
    asset.name = label + "_control";

    var exposed = new UnityEngine.ExposedReference<UnityEngine.GameObject>();
    var id = new UnityEngine.PropertyName(System.Guid.NewGuid().ToString("N"));
    exposed.exposedName = id;
    asset.sourceGameObject = exposed;
    // A broken clip keeps the exposedName but never gets a value registered,
    // so resolution returns null at read time.
    if (target != null)
        owner.SetReferenceValue(id, target);

    c.displayName = label;
    c.start = start;
    c.duration = duration;
    c.timeScale = timeScale;
    UnityEditor.EditorUtility.SetDirty(asset);

    controlRows.Add("{\"track\":\"" + EscapeJson(track.name) + "\",\"clip\":\"" + EscapeJson(label)
        + "\",\"start\":" + Num(start) + ",\"duration\":" + Num(duration)
        + ",\"timeScale\":" + Num(timeScale)
        + ",\"resolvable\":" + (target != null ? "true" : "false") + "}");
    return c;
}

// --- L2 (deepest) ---------------------------------------------------------
var l2 = NewTimeline(l2Path, 30f);
var l2Audio = l2.CreateTrack<UnityEngine.Timeline.AudioTrack>(null, "L2_Audio");
AddAudio("AudioSpikeNestedL2", l2Audio, clipTone440, 0.0, 1.0, 0.5, 1.0, false, -1f);

// --- L1 (middle) ----------------------------------------------------------
var l1 = NewTimeline(l1Path, 30f);
var l1Audio = l1.CreateTrack<UnityEngine.Timeline.AudioTrack>(null, "L1_Audio");
AddAudio("AudioSpikeNestedL1", l1Audio, clipClick, 0.0, 1.0, 0.0, 1.0, false, -1f);
var l1Control = l1.CreateTrack<UnityEngine.Timeline.ControlTrack>(null, "L1_Control");
AddControl(l1Control, l1Director, l2Director.gameObject, "ToNestedL2", 1.0, 2.0, 2.0);

// --- Root -----------------------------------------------------------------
var root = NewTimeline(rootPath, 30f);

var aSimple = root.CreateTrack<UnityEngine.Timeline.AudioTrack>(null, "A_Simple");
AddAudio("AudioSpikeRoot", aSimple, clipClick, 0.0, 1.0, 0.0, 1.0, false, -1f);

var group = root.CreateTrack<UnityEngine.Timeline.GroupTrack>(null, "G_Group");
var aInGroup = root.CreateTrack<UnityEngine.Timeline.AudioTrack>(group, "A_InGroup");
TrySetSerializedFloat(aInGroup, trackVolumeCandidates, 0.8f, "trackVolume");
AddAudio("AudioSpikeRoot", aInGroup, clipTone440, 1.0, 2.0, 0.0, 1.0, false, 0.5f);

var aMuted = root.CreateTrack<UnityEngine.Timeline.AudioTrack>(group, "A_Muted");
aMuted.muted = true;
AddAudio("AudioSpikeRoot", aMuted, clipTone880, 1.0, 3.0, 0.0, 1.0, false, -1f);

var aOverlap = root.CreateTrack<UnityEngine.Timeline.AudioTrack>(null, "A_Overlap");
AddAudio("AudioSpikeRoot", aOverlap, clipTone880, 1.5, 3.0, 0.0, 1.0, false, 0.25f);

// clip speed 2.0 + clipIn 0.25 (Q-7 pitch, Q-10 time normalization)
var aSpeed = root.CreateTrack<UnityEngine.Timeline.AudioTrack>(null, "A_Speed");
AddAudio("AudioSpikeRoot", aSpeed, clipTone440, 5.0, 1.0, 0.25, 2.0, false, -1f);

// source 0.5s under a 2.5s clip -> 5 loop repeats
var aLoop = root.CreateTrack<UnityEngine.Timeline.AudioTrack>(null, "A_Loop");
AddAudio("AudioSpikeRoot", aLoop, clipBeep, 8.0, 2.5, 0.0, 1.0, true, -1f);

// mandatory composite case: loop x speed x clipIn (task 6.1)
var aComposite = root.CreateTrack<UnityEngine.Timeline.AudioTrack>(null, "A_Composite");
AddAudio("AudioSpikeRoot", aComposite, clipBeep, 18.0, 3.0, 0.125, 1.5, true, 0.75f);

var rootControl = root.CreateTrack<UnityEngine.Timeline.ControlTrack>(null, "C_Nested");
AddControl(rootControl, rootDirector, l1Director.gameObject, "ToNestedL1", 11.0, 4.0, 0.5);
AddControl(rootControl, rootDirector, null, "BrokenRef", 16.0, 2.0, 1.0);

// -------------------------------------------------------- bind directors (3)

rootDirector.playableAsset = root;
l1Director.playableAsset = l1;
l2Director.playableAsset = l2;

var rootDuration = root.duration;
var rootFps = root.editorSettings.fps;

// ------------------------------------------------------------------ save (4)

UnityEditor.EditorUtility.SetDirty(root);
UnityEditor.EditorUtility.SetDirty(l1);
UnityEditor.EditorUtility.SetDirty(l2);
UnityEditor.EditorUtility.SetDirty(rootDirector);
UnityEditor.EditorUtility.SetDirty(l1Director);
UnityEditor.EditorUtility.SetDirty(l2Director);

UnityEditor.SceneManagement.EditorSceneManager.MarkSceneDirty(scene);
UnityEditor.SceneManagement.EditorSceneManager.SaveScene(scene, scenePath);
UnityEditor.AssetDatabase.SaveAssets();
UnityEditor.AssetDatabase.Refresh();

// --------------------------------------------------------------------- result

var sb = new System.Text.StringBuilder();
sb.Append("{\"ok\":true");
sb.Append(",\"scene\":\"").Append(EscapeJson(scenePath)).Append("\"");
sb.Append(",\"rootTimeline\":\"").Append(EscapeJson(rootPath)).Append("\"");
sb.Append(",\"rootDurationSec\":").Append(Num(rootDuration));
sb.Append(",\"timelineFps\":").Append(Num(rootFps));
sb.Append(",\"audioClips\":[").Append(string.Join(",", rows.ToArray())).Append("]");
sb.Append(",\"controlClips\":[").Append(string.Join(",", controlRows.ToArray())).Append("]");
sb.Append(",\"volumePropertyPaths\":{");
var first = true;
foreach (var kv in volumePathsUsed)
{
    if (!first) sb.Append(",");
    first = false;
    sb.Append("\"").Append(EscapeJson(kv.Key)).Append("\":\"").Append(EscapeJson(kv.Value)).Append("\"");
}
sb.Append("}");
sb.Append(",\"notes\":[");
for (var i = 0; i < notes.Count; i++)
{
    if (i > 0) sb.Append(",");
    sb.Append("\"").Append(EscapeJson(notes[i])).Append("\"");
}
sb.Append("]}");
return sb.ToString();

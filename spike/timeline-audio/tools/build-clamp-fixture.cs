// Unity eval payload: a dedicated fixture for the ancestor visible-window clamp.
//
// The main AudioSpikeRoot fixture happens to contain no clamped clip, so it
// cannot prove the two clamp behaviours the extraction payload must implement.
// This builds a minimal scene that does, without disturbing the 6.1 sync
// baseline measured against AudioSpikeRoot.
//
//   unity command eval_file --project-path <spike/unity-project> <this file> --timeout 180
//
// Layout (ControlClip at root 10.0, duration 2.0, timeScale 1.0, clipIn 1.0):
//   ancestor visible window (root) = [10.0, 12.0]
//   offset' = R_S - clipIn/speed' = 10.0 - 1.0 = 9.0, so L1 local t -> root 9.0 + t
//
//   ClipHeadClamped  L1 local [0.0, 3.0] -> root [ 9.0, 12.0]  head clamped by 1.0 s
//                    => rootStartSec 10.0 AND clipInSec advanced by 1.0 * effectiveSpeed
//   ClipOutside      L1 local [4.0, 5.0] -> root [13.0, 14.0]  entirely outside the window
//                    => excluded with an "outside-visible-window" warning, no entry

string EscapeJson(string v)
{
    return v == null ? "" : v.Replace("\\", "\\\\").Replace("\"", "\\\"");
}

var scenePath = "Assets/Scenes/AudioSpikeClamp.unity";
var rootPath = "Assets/Timeline/AudioSpikeClampRoot.playable";
var childPath = "Assets/Timeline/AudioSpikeClampChild.playable";

foreach (var p in new string[] { rootPath, childPath, scenePath })
{
    if (UnityEditor.AssetDatabase.LoadAssetAtPath<UnityEngine.Object>(p) != null)
        UnityEditor.AssetDatabase.DeleteAsset(p);
}

var audio = UnityEditor.AssetDatabase.LoadAssetAtPath<UnityEngine.AudioClip>(
    "Assets/Audio/click_48k_st_1s.wav");
if (audio == null) return "{\"ok\":false,\"error\":\"missing click fixture\"}";

// Scene and directors first: ControlPlayableAsset exposed references need a
// director to register against, and saving mid-build reimports the .playable
// and destroys the sub-assets we are still holding.
var scene = UnityEditor.SceneManagement.EditorSceneManager.NewScene(
    UnityEditor.SceneManagement.NewSceneSetup.EmptyScene,
    UnityEditor.SceneManagement.NewSceneMode.Single);

var rootGo = new UnityEngine.GameObject("Root");
var rootDirector = rootGo.AddComponent<UnityEngine.Playables.PlayableDirector>();
rootDirector.playOnAwake = false;
var childGo = new UnityEngine.GameObject("Child");
var childDirector = childGo.AddComponent<UnityEngine.Playables.PlayableDirector>();
childDirector.playOnAwake = false;

var child = UnityEngine.ScriptableObject.CreateInstance<UnityEngine.Timeline.TimelineAsset>();
UnityEditor.AssetDatabase.CreateAsset(child, childPath);
child.editorSettings.frameRate = 30.0;

UnityEngine.Timeline.TimelineClip AddAudio(
    UnityEngine.Timeline.TimelineAsset timeline, string trackName,
    double start, double duration)
{
    var track = timeline.CreateTrack<UnityEngine.Timeline.AudioTrack>(null, trackName);
    var c = track.CreateClip<UnityEngine.Timeline.AudioPlayableAsset>();
    ((UnityEngine.Timeline.AudioPlayableAsset)c.asset).clip = audio;
    ((UnityEngine.Timeline.AudioPlayableAsset)c.asset).loop = true; // keep it audible past 1 s
    c.displayName = trackName;
    c.start = start;
    c.duration = duration;
    return c;
}

AddAudio(child, "ClipHeadClamped", 0.0, 3.0);
AddAudio(child, "ClipOutside", 4.0, 1.0);

var root = UnityEngine.ScriptableObject.CreateInstance<UnityEngine.Timeline.TimelineAsset>();
UnityEditor.AssetDatabase.CreateAsset(root, rootPath);
root.editorSettings.frameRate = 30.0;

var controlTrack = root.CreateTrack<UnityEngine.Timeline.ControlTrack>(null, "C_Child");
var controlClip = controlTrack.CreateClip<UnityEngine.Timeline.ControlPlayableAsset>();
var cpa = (UnityEngine.Timeline.ControlPlayableAsset)controlClip.asset;
cpa.updateDirector = true;
cpa.updateParticle = false;
cpa.searchHierarchy = false;
cpa.active = true;
var exposed = new UnityEngine.ExposedReference<UnityEngine.GameObject>();
var id = new UnityEngine.PropertyName(System.Guid.NewGuid().ToString("N"));
exposed.exposedName = id;
cpa.sourceGameObject = exposed;
rootDirector.SetReferenceValue(id, childGo);
controlClip.displayName = "ToChild";
controlClip.start = 10.0;
controlClip.duration = 2.0;
controlClip.clipIn = 1.0;
controlClip.timeScale = 1.0;

rootDirector.playableAsset = root;
childDirector.playableAsset = child;

UnityEditor.EditorUtility.SetDirty(root);
UnityEditor.EditorUtility.SetDirty(child);
UnityEditor.EditorUtility.SetDirty(rootDirector);
UnityEditor.SceneManagement.EditorSceneManager.MarkSceneDirty(scene);
UnityEditor.SceneManagement.EditorSceneManager.SaveScene(scene, scenePath);
UnityEditor.AssetDatabase.SaveAssets();

return "{\"ok\":true,\"scene\":\"" + EscapeJson(scenePath)
    + "\",\"expected\":{\"windowRoot\":[10.0,12.0],\"childOffset\":9.0,"
    + "\"ClipHeadClamped\":{\"rootStartSec\":10.0,\"clipInSec\":1.0},"
    + "\"ClipOutside\":\"excluded with outside-visible-window\"}}";

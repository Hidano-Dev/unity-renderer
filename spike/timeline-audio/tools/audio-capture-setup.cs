// Unity eval payload (stage 1 of 2): prepare a Unity-reference audio capture.
//
// Mirrors the two-stage shape core established (spike P-7): the Recorder
// configuration cannot be built here because entering Play Mode triggers a
// domain reload that would wipe it. This stage only opens the scene, validates
// the director, and requests Play Mode.
//
// Sent with:  unity command eval_file --project-path <spike/unity-project> <this file> --timeout 120
//
// Edit "scenePath" / "directorName" below to capture a different fixture.

var scenePath = "Assets/Scenes/AudioSpike.unity";
var directorName = "Root";
var statusPath = System.IO.Path.Combine(
    System.IO.Path.GetTempPath(), "timeline-audio-spike-session", "capture-status.json");

System.IO.Directory.CreateDirectory(System.IO.Path.GetDirectoryName(statusPath));

if (UnityEngine.Application.isPlaying)
    throw new System.InvalidOperationException("Editor is already in Play Mode; exit it before starting a capture");

var scene = UnityEditor.SceneManagement.EditorSceneManager.OpenScene(
    scenePath, UnityEditor.SceneManagement.OpenSceneMode.Single);

UnityEngine.Playables.PlayableDirector director = null;
foreach (var root in scene.GetRootGameObjects())
{
    var candidate = root.GetComponent<UnityEngine.Playables.PlayableDirector>();
    if (candidate != null && candidate.name == directorName) { director = candidate; break; }
}
if (director == null)
    throw new System.ArgumentException("Root PlayableDirector not found: " + directorName);

var timeline = director.playableAsset as UnityEngine.Timeline.TimelineAsset;
if (timeline == null)
    throw new System.ArgumentException("PlayableDirector has no TimelineAsset");

var hasListener = false;
foreach (var root in scene.GetRootGameObjects())
    if (root.GetComponentInChildren<UnityEngine.AudioListener>() != null) hasListener = true;
if (!hasListener)
    throw new System.InvalidOperationException("Scene has no AudioListener; nothing would reach Unity's audio output");

// Keep the timeline at rest until stage 2 seeks and starts it.
director.playOnAwake = false;

// Stage 2 reads these back out of SessionState, which survives the Play Mode
// domain reload.
UnityEditor.SessionState.SetString("spike.audio.directorName", directorName);
UnityEditor.SessionState.SetString("spike.audio.statusPath", statusPath);
UnityEditor.SessionState.EraseString("spike.audio.started");

var tempPath = statusPath + ".tmp";
System.IO.File.WriteAllText(tempPath, "{\"state\":\"preparing\"}", new System.Text.UTF8Encoding(false));
if (System.IO.File.Exists(statusPath))
    System.IO.File.Replace(tempPath, statusPath, null);
else
    System.IO.File.Move(tempPath, statusPath);

UnityEditor.EditorApplication.isPlaying = true;

return "{\"playModeRequested\":true,\"scene\":\"" + scenePath + "\",\"director\":\"" + directorName
    + "\",\"durationSec\":" + timeline.duration.ToString("R", System.Globalization.CultureInfo.InvariantCulture)
    + ",\"fps\":" + timeline.editorSettings.fps.ToString("R", System.Globalization.CultureInfo.InvariantCulture)
    + ",\"statusPath\":\"" + statusPath.Replace("\\", "\\\\") + "\"}";

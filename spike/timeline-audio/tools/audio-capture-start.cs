// Unity eval payload (stage 2 of 2): capture Unity's own Timeline audio mix to a
// WAV via Recorder's AudioRecorderSettings, so Q-2 (loop), Q-7 (pitch),
// Q-10 (timing) and Q-11 (mix equivalence) can be judged from waveforms instead
// of by ear.
//
// Must run inside Play Mode. Sent with:
//   unity command eval_file --project-path <spike/unity-project> <this file> --timeout 300

if (!UnityEngine.Application.isPlaying)
    throw new System.InvalidOperationException("PLAY_MODE_NOT_READY: the Play Mode transition has not completed yet");

var directorName = UnityEditor.SessionState.GetString("spike.audio.directorName", "Root");
var statusPath = UnityEditor.SessionState.GetString("spike.audio.statusPath", "");
if (string.IsNullOrEmpty(statusPath))
    throw new System.InvalidOperationException("statusPath missing; run audio-capture-setup.cs first");

if (UnityEditor.SessionState.GetString("spike.audio.started", "") == "1")
    return "{\"alreadyStarted\":true}";

var outputDir = System.IO.Path.GetDirectoryName(statusPath);
var outputStem = System.IO.Path.Combine(outputDir, "unity-reference").Replace("\\", "/");

string JsonEscape(string v) { return v.Replace("\\", "\\\\").Replace("\"", "\\\""); }
void WriteStatus(string body)
{
    var tmp = statusPath + ".tmp";
    System.IO.File.WriteAllText(tmp, body, new System.Text.UTF8Encoding(false));
    if (System.IO.File.Exists(statusPath))
        System.IO.File.Replace(tmp, statusPath, null);
    else
        System.IO.File.Move(tmp, statusPath);
}

UnityEngine.Playables.PlayableDirector director = null;
foreach (var root in UnityEngine.SceneManagement.SceneManager.GetActiveScene().GetRootGameObjects())
{
    var candidate = root.GetComponent<UnityEngine.Playables.PlayableDirector>();
    if (candidate != null && candidate.name == directorName) { director = candidate; break; }
}
if (director == null)
{
    WriteStatus("{\"state\":\"failed\",\"reason\":\"director not found in Play Mode\"}");
    throw new System.ArgumentException("Root PlayableDirector not found in Play Mode: " + directorName);
}

var timeline = (UnityEngine.Timeline.TimelineAsset)director.playableAsset;
var fps = timeline.editorSettings.frameRate;
var durationSec = timeline.duration;
var totalFrames = checked((int)System.Math.Round(durationSec * fps));
if (totalFrames < 1) totalFrames = 1;

// CapFrameRate locks game time to the capture rate, so the captured audio is
// deterministic rather than dependent on how fast the Editor happens to run.
var controllerSettings = UnityEngine.ScriptableObject.CreateInstance<UnityEditor.Recorder.RecorderControllerSettings>();
controllerSettings.hideFlags = UnityEngine.HideFlags.DontSave;
// TimelineAsset.editorSettings.frameRate is a double in Timeline 1.7;
// RecorderControllerSettings.FrameRate is a float.
controllerSettings.FrameRate = (float)fps;
controllerSettings.CapFrameRate = true;
controllerSettings.SetRecordModeToFrameInterval(0, totalFrames - 1);

var audioSettings = UnityEngine.ScriptableObject.CreateInstance<UnityEditor.Recorder.AudioRecorderSettings>();
audioSettings.hideFlags = UnityEngine.HideFlags.DontSave;
audioSettings.name = "spike audio reference";
audioSettings.Enabled = true;
// AudioRecorderSettings.AudioInputSettings is internal in Recorder 5.1, so
// PreserveAudio cannot be set from an eval payload. Its default is true, which
// is what a reference capture needs anyway.
audioSettings.OutputFile = outputStem;
controllerSettings.AddRecorderSettings(audioSettings);

director.time = 0.0;
director.Evaluate();
director.Play();

var controller = new UnityEditor.Recorder.RecorderController(controllerSettings);
UnityEditor.SessionState.SetString("spike.audio.started", "1");
try
{
    controller.PrepareRecording();
    if (!controller.StartRecording())
        throw new System.InvalidOperationException("RecorderController.StartRecording returned false");
}
catch (System.Exception e)
{
    UnityEditor.SessionState.EraseString("spike.audio.started");
    WriteStatus("{\"state\":\"failed\",\"reason\":\"" + JsonEscape(e.Message) + "\"}");
    throw;
}

var startedAt = UnityEditor.EditorApplication.timeSinceStartup;

void Monitor()
{
    try
    {
        if (controller.IsRecording())
        {
            var elapsed = UnityEditor.EditorApplication.timeSinceStartup - startedAt;
            // Hard stop so a stuck capture cannot hold Play Mode forever.
            if (elapsed > durationSec * 6 + 120)
            {
                UnityEditor.EditorApplication.update -= Monitor;
                controller.StopRecording();
                WriteStatus("{\"state\":\"failed\",\"reason\":\"capture timed out\"}");
                UnityEditor.EditorApplication.isPlaying = false;
            }
            return;
        }

        UnityEditor.EditorApplication.update -= Monitor;
        // Status must be written before leaving Play Mode: the domain reload
        // that follows would drop this callback and the file would never appear.
        WriteStatus("{\"state\":\"completed\",\"outputStem\":\"" + JsonEscape(outputStem)
            + "\",\"expectedDurationSec\":" + durationSec.ToString("R", System.Globalization.CultureInfo.InvariantCulture)
            + ",\"frames\":" + totalFrames + "}");
        UnityEditor.EditorApplication.isPlaying = false;
    }
    catch (System.Exception e)
    {
        UnityEditor.EditorApplication.update -= Monitor;
        WriteStatus("{\"state\":\"failed\",\"reason\":\"" + JsonEscape(e.Message) + "\"}");
        UnityEditor.EditorApplication.isPlaying = false;
    }
}

UnityEditor.EditorApplication.update += Monitor;
WriteStatus("{\"state\":\"recording\",\"frames\":" + totalFrames + "}");

return "{\"recordingStarted\":true,\"totalFrames\":" + totalFrames
    + ",\"fps\":" + fps.ToString("R", System.Globalization.CultureInfo.InvariantCulture)
    + ",\"outputStem\":\"" + JsonEscape(outputStem) + "\"}";

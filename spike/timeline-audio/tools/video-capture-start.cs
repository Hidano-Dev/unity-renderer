// Unity eval payload (stage 2 of 2): capture the fixture timeline as silent
// MP4 and MOV(ProRes) with Recorder, so spike question Q-9 can be measured
// against real Recorder output rather than synthetic files.
//
// Run audio-capture-setup.cs first (it opens the scene and enters Play Mode);
// this payload replaces audio-capture-start.cs for the video pass.
//
// Must run inside Play Mode. Sent with:
//   unity command eval_file --project-path <spike/unity-project> <this file> --timeout 600

if (!UnityEngine.Application.isPlaying)
    throw new System.InvalidOperationException("PLAY_MODE_NOT_READY: the Play Mode transition has not completed yet");

var directorName = UnityEditor.SessionState.GetString("spike.audio.directorName", "Root");
var statusPath = UnityEditor.SessionState.GetString("spike.audio.statusPath", "");
if (string.IsNullOrEmpty(statusPath))
    throw new System.InvalidOperationException("statusPath missing; run audio-capture-setup.cs first");

if (UnityEditor.SessionState.GetString("spike.video.started", "") == "1")
    return "{\"alreadyStarted\":true}";

var outputDir = System.IO.Path.GetDirectoryName(statusPath);

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

const int width = 640;
const int height = 360;

var controllerSettings = UnityEngine.ScriptableObject.CreateInstance<UnityEditor.Recorder.RecorderControllerSettings>();
controllerSettings.hideFlags = UnityEngine.HideFlags.DontSave;
controllerSettings.FrameRate = (float)fps;
controllerSettings.CapFrameRate = true;
controllerSettings.SetRecordModeToFrameInterval(0, totalFrames - 1);

// Both containers are produced in the same pass, which is how core records them.
var mp4Stem = System.IO.Path.Combine(outputDir, "video-silent-mp4").Replace("\\", "/");
var movStem = System.IO.Path.Combine(outputDir, "video-silent-mov").Replace("\\", "/");

var mp4 = UnityEngine.ScriptableObject.CreateInstance<UnityEditor.Recorder.MovieRecorderSettings>();
mp4.hideFlags = UnityEngine.HideFlags.DontSave;
mp4.name = "spike mp4";
mp4.Enabled = true;
mp4.FrameRate = (float)fps;
mp4.CaptureAudio = false;   // the audio is muxed in later by ffmpeg
mp4.CaptureAlpha = false;
mp4.ImageInputSettings = new UnityEditor.Recorder.Input.GameViewInputSettings { OutputWidth = width, OutputHeight = height };
mp4.EncoderSettings = new UnityEditor.Recorder.Encoder.CoreEncoderSettings
{
    Codec = UnityEditor.Recorder.Encoder.CoreEncoderSettings.OutputCodec.MP4
};
mp4.OutputFile = mp4Stem;
controllerSettings.AddRecorderSettings(mp4);

var mov = UnityEngine.ScriptableObject.CreateInstance<UnityEditor.Recorder.MovieRecorderSettings>();
mov.hideFlags = UnityEngine.HideFlags.DontSave;
mov.name = "spike mov";
mov.Enabled = true;
mov.FrameRate = (float)fps;
mov.CaptureAudio = false;
mov.CaptureAlpha = false;
mov.ImageInputSettings = new UnityEditor.Recorder.Input.GameViewInputSettings { OutputWidth = width, OutputHeight = height };
mov.EncoderSettings = new UnityEditor.Recorder.Encoder.ProResEncoderSettings
{
    Format = UnityEditor.Recorder.Encoder.ProResEncoderSettings.OutputFormat.ProRes422HQ
};
mov.OutputFile = movStem;
controllerSettings.AddRecorderSettings(mov);

director.time = 0.0;
director.Evaluate();
director.Play();

UnityEngine.Rendering.AsyncGPUReadback.WaitAllRequests();
var controller = new UnityEditor.Recorder.RecorderController(controllerSettings);
UnityEditor.SessionState.SetString("spike.video.started", "1");
try
{
    controller.PrepareRecording();
    if (!controller.StartRecording())
        throw new System.InvalidOperationException("RecorderController.StartRecording returned false");
}
catch (System.Exception e)
{
    UnityEditor.SessionState.EraseString("spike.video.started");
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
            UnityEngine.Rendering.AsyncGPUReadback.WaitAllRequests();
            var elapsed = UnityEditor.EditorApplication.timeSinceStartup - startedAt;
            if (elapsed > durationSec * 20 + 300)
            {
                UnityEditor.EditorApplication.update -= Monitor;
                controller.StopRecording();
                WriteStatus("{\"state\":\"failed\",\"reason\":\"capture timed out\"}");
                UnityEditor.EditorApplication.isPlaying = false;
            }
            return;
        }

        UnityEditor.EditorApplication.update -= Monitor;
        WriteStatus("{\"state\":\"completed\",\"mp4Stem\":\"" + JsonEscape(mp4Stem)
            + "\",\"movStem\":\"" + JsonEscape(movStem)
            + "\",\"frames\":" + totalFrames
            + ",\"elapsedSec\":" + (UnityEditor.EditorApplication.timeSinceStartup - startedAt).ToString("0.###", System.Globalization.CultureInfo.InvariantCulture)
            + "}");
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
    + ",\"width\":" + width + ",\"height\":" + height
    + ",\"fps\":" + fps.ToString("R", System.Globalization.CultureInfo.InvariantCulture) + "}";

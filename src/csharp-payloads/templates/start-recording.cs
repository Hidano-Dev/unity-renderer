// Unity eval payload (stage 2 of 2): must run inside Play Mode. Rebuilds the
// in-memory Recorder configuration (spike P-7: edit-mode objects do not survive
// the Play Mode domain reload), starts the recording through RecorderController,
// and registers an update callback that publishes status JSON atomically.
// Nothing is ever registered as a project asset.
var parametersJson = /*__PARAMS_JSON__*/;

string JsonString(string json, string key)
{
    var match = System.Text.RegularExpressions.Regex.Match(json, "\\\"" + key + "\\\"\\s*:\\s*\\\"((?:\\\\.|[^\\\"\\\\])*)\\\"");
    if (!match.Success)
        throw new System.ArgumentException("Missing required payload parameter: " + key);
    return System.Text.RegularExpressions.Regex.Unescape(match.Groups[1].Value);
}
string JsonNumber(string json, string key)
{
    var match = System.Text.RegularExpressions.Regex.Match(json, "\\\"" + key + "\\\"\\s*:\\s*(-?[0-9]+(?:\\.[0-9]+)?)");
    if (!match.Success)
        throw new System.ArgumentException("Missing required payload parameter: " + key);
    return match.Groups[1].Value;
}
string JsonEscape(string value)
{
    return value.Replace("\\", "\\\\").Replace("\"", "\\\"");
}

// The CLI retries this payload until the Play Mode transition has completed.
// Throwing here is side-effect free by design.
if (!UnityEngine.Application.isPlaying)
    throw new System.InvalidOperationException("PLAY_MODE_NOT_READY: the Play Mode transition has not completed yet");

var statusPath = JsonString(parametersJson, "statusPath");
var operationId = JsonString(parametersJson, "operationId");
var directorName = JsonString(parametersJson, "directorName");
var width = int.Parse(JsonNumber(parametersJson, "width"), System.Globalization.CultureInfo.InvariantCulture);
var height = int.Parse(JsonNumber(parametersJson, "height"), System.Globalization.CultureInfo.InvariantCulture);
var frameRate = double.Parse(JsonNumber(parametersJson, "frameRate"), System.Globalization.CultureInfo.InvariantCulture);
var inPoint = double.Parse(JsonNumber(parametersJson, "inPoint"), System.Globalization.CultureInfo.InvariantCulture);
var outPoint = double.Parse(JsonNumber(parametersJson, "outPoint"), System.Globalization.CultureInfo.InvariantCulture);

var statusDirectory = System.IO.Path.GetDirectoryName(statusPath);
if (string.IsNullOrEmpty(statusDirectory))
    throw new System.ArgumentException("statusPath must include a directory");
System.IO.Directory.CreateDirectory(statusDirectory);

void WriteStatus(string bodyJson)
{
    var tempPath = statusPath + ".tmp";
    System.IO.File.WriteAllText(tempPath, bodyJson, new System.Text.UTF8Encoding(false));
    System.IO.File.Move(tempPath, statusPath, true);
}
string StatusJson(string state, string extraFields)
{
    return "{\"operationId\":\"" + JsonEscape(operationId) + "\",\"state\":\"" + state + "\"" + extraFields + "}";
}

var directorObject = System.Linq.Enumerable.FirstOrDefault(
    UnityEngine.Object.FindObjectsByType<UnityEngine.Playables.PlayableDirector>(
        UnityEngine.FindObjectsSortMode.None),
    director => director.name == directorName);
if (directorObject == null)
{
    WriteStatus(StatusJson("failed", ",\"reason\":\"PlayableDirector not found in Play Mode: " + JsonEscape(directorName) + "\""));
    throw new System.ArgumentException("PlayableDirector not found in Play Mode: " + directorName);
}

// RecorderControllerSettings.FrameRate + CapFrameRate lock game time to the
// configured capture rate, which is how the effective frame rate override is
// enforced in the controller-driven pass.
var controllerSettings = UnityEngine.ScriptableObject.CreateInstance<UnityEditor.Recorder.RecorderControllerSettings>();
controllerSettings.hideFlags = UnityEngine.HideFlags.DontSave;
controllerSettings.FrameRate = (float)frameRate;
controllerSettings.CapFrameRate = true;
var totalFrames = (int)System.Math.Round((outPoint - inPoint) * frameRate);
if (totalFrames < 1)
    totalFrames = 1;
controllerSettings.SetRecordModeToFrameInterval(0, totalFrames - 1);

var outputMatches = System.Text.RegularExpressions.Regex.Matches(
    parametersJson,
    "\\{\\s*\\\"format\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"\\s*,\\s*\\\"absolutePath\\\"\\s*:\\s*\\\"((?:\\\\.|[^\\\"\\\\])*)\\\"\\s*\\}");
if (outputMatches.Count == 0)
    throw new System.ArgumentException("At least one recorder output is required");

foreach (System.Text.RegularExpressions.Match output in outputMatches)
{
    var format = output.Groups[1].Value.ToLowerInvariant();
    var outputPath = System.Text.RegularExpressions.Regex.Unescape(output.Groups[2].Value);
    var movie = UnityEngine.ScriptableObject.CreateInstance<UnityEditor.Recorder.MovieRecorderSettings>();
    movie.hideFlags = UnityEngine.HideFlags.DontSave;
    movie.name = "unity-render-core " + format;
    movie.Enabled = true;
    movie.FrameRate = (float)frameRate;
    movie.CaptureAudio = false;
    movie.CaptureAlpha = false;
    movie.ImageInputSettings = new UnityEditor.Recorder.Input.GameViewInputSettings
    {
        OutputWidth = width,
        OutputHeight = height
    };
    if (format == "mp4")
        movie.EncoderSettings = new UnityEditor.Recorder.Encoder.CoreEncoderSettings
        {
            Codec = UnityEditor.Recorder.Encoder.CoreEncoderSettings.OutputCodec.MP4
        };
    else if (format == "mov-prores")
        movie.EncoderSettings = new UnityEditor.Recorder.Encoder.ProResEncoderSettings
        {
            Format = UnityEditor.Recorder.Encoder.ProResEncoderSettings.OutputFormat.ProRes422HQ
        };
    else
        throw new System.ArgumentException("Unsupported recorder format: " + format);

    // RecorderSettings.OutputFile appends the container extension automatically,
    // so the planned path must be stripped down to its extension-less form.
    var outputDirectory = System.IO.Path.GetDirectoryName(outputPath);
    var outputStem = System.IO.Path.GetFileNameWithoutExtension(outputPath);
    movie.OutputFile = System.IO.Path.Combine(outputDirectory, outputStem).Replace("\\", "/");
    controllerSettings.AddRecorderSettings(movie);
}

// Align the timeline with the requested range before capture starts. playOnAwake
// was disabled in setup-recorder.cs, so the director is still at rest here.
directorObject.time = inPoint;
directorObject.Evaluate();
directorObject.Play();

UnityEngine.Rendering.AsyncGPUReadback.WaitAllRequests();
var controller = new UnityEditor.Recorder.RecorderController(controllerSettings);
controller.PrepareRecording();
if (!controller.StartRecording())
{
    WriteStatus(StatusJson("failed", ",\"reason\":\"RecorderController.StartRecording returned false\""));
    throw new System.InvalidOperationException("RecorderController.StartRecording returned false");
}

var startedAt = UnityEditor.EditorApplication.timeSinceStartup;
var lastBucket = -1L;

void MonitorRecording()
{
    try
    {
        if (controller.IsRecording())
        {
            var elapsedSec = UnityEditor.EditorApplication.timeSinceStartup - startedAt;
            // Throttle to one atomic write per 250 ms; the CLI polls at the same cadence.
            var bucket = (long)(elapsedSec * 4);
            if (bucket == lastBucket)
                return;
            lastBucket = bucket;
            WriteStatus(StatusJson("recording", ",\"elapsedSec\":" + elapsedSec.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture)));
            return;
        }

        UnityEditor.EditorApplication.update -= MonitorRecording;
        WriteStatus(StatusJson("completed", ",\"timelineDurationSec\":" + (outPoint - inPoint).ToString("0.###", System.Globalization.CultureInfo.InvariantCulture)));
    }
    catch (System.Exception exception)
    {
        UnityEditor.EditorApplication.update -= MonitorRecording;
        WriteStatus(StatusJson("failed", ",\"reason\":\"" + JsonEscape(exception.Message) + "\""));
    }
}

UnityEditor.EditorApplication.update += MonitorRecording;
WriteStatus(StatusJson("recording", ",\"elapsedSec\":0"));
return "{\"recordingStarted\":true,\"totalFrames\":" + totalFrames + "}";

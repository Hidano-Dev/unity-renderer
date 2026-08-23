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
    // JSON.stringify は 1e-7 のような指数表記を出す。指数部を取り込まないと
    // 先頭の仮数だけを拾い、検証済み設定と異なる値で録画してしまう
    var match = System.Text.RegularExpressions.Regex.Match(json, "\\\"" + key + "\\\"\\s*:\\s*(-?[0-9]+(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)\\s*(?=[,}])");
    if (!match.Success)
        throw new System.ArgumentException("Missing required payload parameter: " + key);
    return match.Groups[1].Value;
}
double ParseDouble(string value)
{
    return double.Parse(value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture);
}
int ParseInt(string value)
{
    return checked((int)System.Math.Round(ParseDouble(value)));
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
var width = ParseInt(JsonNumber(parametersJson, "width"));
var height = ParseInt(JsonNumber(parametersJson, "height"));
var frameRate = ParseDouble(JsonNumber(parametersJson, "frameRate"));
var inPoint = ParseDouble(JsonNumber(parametersJson, "inPoint"));
var outPoint = ParseDouble(JsonNumber(parametersJson, "outPoint"));

var statusDirectory = System.IO.Path.GetDirectoryName(statusPath);
if (string.IsNullOrEmpty(statusDirectory))
    throw new System.ArgumentException("statusPath must include a directory");
System.IO.Directory.CreateDirectory(statusDirectory);

// 冪等化: transport error は「Unity が payload を実行していないこと」を保証しない。
// StartRecording まで進んだ後に応答だけ失われた場合、CLI の再送で 2 つ目の
// RecorderController が同じ出力パスへ並走し動画を破損させる。SessionState は
// ドメインリロードを跨いで生き残るため、operationId の実行済み判定に使う。
const string StartedOperationKey = "unity-render-core.startedOperationId";
if (UnityEditor.SessionState.GetString(StartedOperationKey, "") == operationId)
    return "{\"recordingStarted\":true,\"alreadyStarted\":true}";

void WriteStatus(string bodyJson)
{
    // File.Move(src, dst, overwrite) is unavailable in Unity's C# profile; use the
    // atomic File.Replace when the destination exists.
    var tempPath = statusPath + ".tmp";
    System.IO.File.WriteAllText(tempPath, bodyJson, new System.Text.UTF8Encoding(false));
    if (System.IO.File.Exists(statusPath))
        System.IO.File.Replace(tempPath, statusPath, null);
    else
        System.IO.File.Move(tempPath, statusPath);
}
string StatusJson(string state, string extraFields)
{
    return "{\"operationId\":\"" + JsonEscape(operationId) + "\",\"state\":\"" + state + "\"" + extraFields + "}";
}

// open-scene.cs / setup-recorder.cs と同じ「アクティブシーンの root を順に走査」で
// 選択を再現し、同名の入れ子 Director や順序不定の誤選択を防ぐ
UnityEngine.Playables.PlayableDirector directorObject = null;
foreach (var root in UnityEngine.SceneManagement.SceneManager.GetActiveScene().GetRootGameObjects())
{
    var candidate = root.GetComponent<UnityEngine.Playables.PlayableDirector>();
    if (candidate != null && candidate.name == directorName)
    {
        directorObject = candidate;
        break;
    }
}
if (directorObject == null)
{
    WriteStatus(StatusJson("failed", ",\"reason\":\"Root PlayableDirector not found in Play Mode: " + JsonEscape(directorName) + "\""));
    throw new System.ArgumentException("Root PlayableDirector not found in Play Mode: " + directorName);
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
// 開始を先に claim し、失敗経路では取り消す。応答が失われても claim は残るため
// 再送は上のガードで弾かれ、二重録画が起きない
UnityEditor.SessionState.SetString(StartedOperationKey, operationId);
try
{
    controller.PrepareRecording();
    if (!controller.StartRecording())
        throw new System.InvalidOperationException("RecorderController.StartRecording returned false");
}
catch (System.Exception startException)
{
    UnityEditor.SessionState.EraseString(StartedOperationKey);
    WriteStatus(StatusJson("failed", ",\"reason\":\"" + JsonEscape(startException.Message) + "\""));
    throw;
}

var startedAt = UnityEditor.EditorApplication.timeSinceStartup;
var lastBucket = -1L;

void MonitorRecording()
{
    try
    {
        if (controller.IsRecording())
        {
            // Requirement 9.5: 書き出し中は常に同期化を有効にする。開始前の 1 回では
            // 以降のキャプチャフレームが発行する readback を待てず、フレーム欠落を
            // 防げないため、録画中は毎フレーム完了を待つ
            UnityEngine.Rendering.AsyncGPUReadback.WaitAllRequests();
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

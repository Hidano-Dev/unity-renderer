// Unity eval payload: build Recorder objects in memory and never register assets.
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
string JsonBool(string json, string key)
{
    var match = System.Text.RegularExpressions.Regex.Match(json, "\\\"" + key + "\\\"\\s*:\\s*(true|false)");
    if (!match.Success)
        throw new System.ArgumentException("Missing required payload parameter: " + key);
    return match.Groups[1].Value;
}

// RecorderTrack/RecorderClip/MovieRecorderSettings are deliberately never registered
// as project assets. HideFlags.DontSave keeps every object memory-only.
var width = int.Parse(JsonNumber(parametersJson, "width"), System.Globalization.CultureInfo.InvariantCulture);
var height = int.Parse(JsonNumber(parametersJson, "height"), System.Globalization.CultureInfo.InvariantCulture);
var frameRate = double.Parse(JsonNumber(parametersJson, "frameRate"), System.Globalization.CultureInfo.InvariantCulture);
var inPoint = double.Parse(JsonNumber(parametersJson, "inPoint"), System.Globalization.CultureInfo.InvariantCulture);
var outPoint = double.Parse(JsonNumber(parametersJson, "outPoint"), System.Globalization.CultureInfo.InvariantCulture);

var directorName = JsonString(parametersJson, "directorName");
var directorObject = System.Linq.Enumerable.FirstOrDefault(
    UnityEngine.Object.FindObjectsByType<UnityEngine.Playables.PlayableDirector>(
        UnityEngine.FindObjectsSortMode.None),
    director => director.name == directorName);
if (directorObject == null)
    throw new System.ArgumentException("PlayableDirector not found: " + directorName);

var timeline = directorObject.playableAsset as UnityEngine.Timeline.TimelineAsset;
if (timeline == null)
    throw new System.ArgumentException("PlayableDirector has no TimelineAsset: " + directorName);
timeline.editorSettings.fps = frameRate;

var track = timeline.CreateTrack<UnityEditor.Recorder.Timeline.RecorderTrack>(null, "unity-render-core Recorder");
track.hideFlags = UnityEngine.HideFlags.DontSave;

var outputMatches = System.Text.RegularExpressions.Regex.Matches(
    parametersJson,
    "\\{\\s*\\\"format\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"\\s*,\\s*\\\"absolutePath\\\"\\s*:\\s*\\\"((?:\\\\.|[^\\\"\\\\])*)\\\"\\s*\\}");
if (outputMatches.Count == 0)
    throw new System.ArgumentException("At least one recorder output is required");

foreach (System.Text.RegularExpressions.Match output in outputMatches)
{
    var format = output.Groups[1].Value.ToLowerInvariant();
    var outputPath = System.Text.RegularExpressions.Regex.Unescape(output.Groups[2].Value);
    var movie = ScriptableObject.CreateInstance<UnityEditor.Recorder.MovieRecorderSettings>();
    movie.hideFlags = UnityEngine.HideFlags.DontSave;
    movie.Enabled = true;
    movie.OutputFile = outputPath;
    movie.FrameRate = frameRate;
    movie.CaptureAudio = false;
    movie.ImageInputSettings = new UnityEditor.Recorder.Input.GameViewInputSettings
    {
        OutputWidth = width,
        OutputHeight = height
    };
    if (format == "mp4")
        movie.OutputFormat = UnityEditor.Recorder.MovieRecorderSettings.VideoRecorderOutputFormat.MP4;
    else if (format == "mov")
    {
        movie.OutputFormat = UnityEditor.Recorder.MovieRecorderSettings.VideoRecorderOutputFormat.MOV;
        movie.EncoderSettings = ScriptableObject.CreateInstance<UnityEditor.Recorder.ProResEncoderSettings>();
        movie.EncoderSettings.hideFlags = UnityEngine.HideFlags.DontSave;
    }
    else
        throw new System.ArgumentException("Unsupported recorder format: " + format);

    var clip = track.CreateClip<UnityEditor.Recorder.Timeline.RecorderClip>();
    clip.start = inPoint;
    clip.end = outPoint;
    var recorderClip = clip.asset as UnityEditor.Recorder.Timeline.RecorderClip;
    recorderClip.hideFlags = UnityEngine.HideFlags.DontSave;
    recorderClip.settings = movie;
}

// The recorder pipeline is synchronized on every setup invocation. The call is
// intentionally outside a project asset or scene save operation.
UnityEngine.Rendering.AsyncGPUReadback.WaitAllRequests();
return "{\"configured\":true,\"directorName\":\"" + directorName + "\",\"inPoint\":" + inPoint.ToString(System.Globalization.CultureInfo.InvariantCulture) + ",\"outPoint\":" + outPoint.ToString(System.Globalization.CultureInfo.InvariantCulture) + ",\"captureAudio\":" + JsonBool("{\"captureAudio\":false}", "captureAudio") + "}";

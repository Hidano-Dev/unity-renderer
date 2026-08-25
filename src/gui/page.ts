const STYLES = `
:root {
  color-scheme: light dark;
  --bg: #f5f6f8;
  --panel: #ffffff;
  --border: #d7dae0;
  --text: #1c1f24;
  --muted: #5d646e;
  --accent: #2f6fdb;
  --accent-text: #ffffff;
  --warn: #9a5b00;
  --error: #b3261e;
  --log-bg: #1e2127;
  --log-text: #e6e6e6;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #16181d;
    --panel: #1f232a;
    --border: #333943;
    --text: #e7e9ec;
    --muted: #a2a9b4;
    --accent: #5a92f0;
    --accent-text: #10131a;
    --warn: #e0a44a;
    --error: #f2857c;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: "Segoe UI", "Yu Gothic UI", "Hiragino Kaku Gothic ProN", sans-serif;
  font-size: 14px;
  line-height: 1.6;
}
header { padding: 20px 24px 8px; }
h1 { margin: 0; font-size: 20px; }
header p { margin: 2px 0 0; color: var(--muted); font-size: 13px; }
main { padding: 8px 24px 24px; max-width: 900px; }
section {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
}
h2 { margin: 0 0 12px; font-size: 15px; }
.count { color: var(--muted); font-weight: normal; font-size: 13px; }
.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.row + .row { margin-top: 10px; }
label.field { display: flex; align-items: center; gap: 6px; color: var(--muted); }
input[type="text"], input[type="number"] {
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  color: var(--text);
  font: inherit;
}
input[type="text"].grow { flex: 1 1 320px; min-width: 200px; }
input[type="number"] { width: 90px; }
button {
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  color: var(--text);
  font: inherit;
  cursor: pointer;
}
button:hover:not(:disabled) { border-color: var(--accent); }
button:disabled { opacity: 0.5; cursor: default; }
button.primary { background: var(--accent); color: var(--accent-text); border-color: var(--accent); }
.hint { margin: 8px 0 0; color: var(--muted); font-size: 12px; }
.scenes { list-style: none; margin: 12px 0 0; padding: 0; max-height: 320px; overflow-y: auto; border: 1px solid var(--border); border-radius: 4px; }
.scenes:empty { display: none; }
.scenes li { border-bottom: 1px solid var(--border); padding: 7px 10px; }
.scenes li[hidden] { display: none; }
.scenes li:last-child { border-bottom: none; }
.scenes label { display: flex; gap: 8px; align-items: baseline; cursor: pointer; }
.scenes label.disabled { cursor: default; opacity: 0.75; }
.scene-name { font-weight: 600; }
.scene-path { color: var(--muted); font-size: 12px; word-break: break-all; }
.scene-warn { display: block; color: var(--warn); font-size: 12px; }
.empty { color: var(--muted); padding: 12px 0 0; }
.issues { list-style: none; margin: 12px 0 0; padding: 0; color: var(--error); }
.issues li { padding: 2px 0; }
.log {
  margin: 12px 0 0;
  padding: 12px;
  min-height: 140px;
  max-height: 320px;
  overflow-y: auto;
  background: var(--log-bg);
  color: var(--log-text);
  border-radius: 4px;
  font-family: Consolas, "Courier New", monospace;
  font-size: 12.5px;
  white-space: pre-wrap;
  word-break: break-all;
}
.status { color: var(--muted); }
footer { padding: 0 24px 24px; color: var(--muted); font-size: 12px; }
`;

const SCRIPT = `
var TOKEN = window.__GUI_TOKEN__;
var scenes = [];
var savedSelection = [];
var scenesLoaded = false;
var running = false;
var saveTimer = null;

function byId(id) { return document.getElementById(id); }

function api(path, options) {
  var opts = options || {};
  opts.headers = { "x-gui-token": TOKEN, "content-type": "application/json" };
  return fetch(path, opts).then(function (response) {
    return response.json().catch(function () { return {}; }).then(function (body) {
      if (!response.ok) {
        var error = new Error(body.message || "リクエストに失敗しました");
        error.issues = body.issues;
        throw error;
      }
      return body;
    });
  });
}

function setSaveStatus(text) { byId("saveStatus").textContent = text; }
function setRunStatus(text) { byId("runStatus").textContent = text; }

function checkedSceneNames() {
  var names = [];
  var boxes = document.querySelectorAll(".scene-check");
  for (var i = 0; i < boxes.length; i += 1) {
    if (boxes[i].checked) names.push(boxes[i].value);
  }
  return names;
}

function selectedFormats() {
  var formats = [];
  var boxes = document.querySelectorAll(".format-check");
  for (var i = 0; i < boxes.length; i += 1) {
    if (boxes[i].checked) formats.push(boxes[i].value);
  }
  return formats;
}

function collect() {
  return {
    projectPath: byId("projectPath").value,
    outputDirectory: byId("outputDirectory").value,
    fileName: byId("fileName").value,
    sceneFilter: byId("sceneFilter").value,
    // Scene 一覧をまだ読めていない間は、保存済みの選択をそのまま返す。
    // 空の一覧から checkedSceneNames() を作ると、パス誤りで一覧が出ない
    // だけの状況で前回の選択を消してしまう
    selectedScenes: scenesLoaded ? checkedSceneNames() : savedSelection,
    resolution: {
      width: Number(byId("width").value),
      height: Number(byId("height").value)
    },
    frameRate: Number(byId("frameRate").value),
    formats: selectedFormats()
  };
}

function scheduleSave() {
  setSaveStatus("保存中…");
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(function () {
    api("/api/state", { method: "PUT", body: JSON.stringify(collect()) })
      .then(function () { setSaveStatus("選択内容を保存しました"); })
      .catch(function (error) { setSaveStatus("保存に失敗しました: " + error.message); });
  }, 400);
}

function visibleSceneBoxes() {
  return document.querySelectorAll("#sceneList li:not([hidden]) .scene-check");
}

function updateSceneCount() {
  var selectable = 0;
  for (var i = 0; i < scenes.length; i += 1) {
    if (scenes[i].selectable) selectable += 1;
  }
  if (!scenesLoaded) {
    byId("sceneCount").textContent = "";
    return;
  }
  var text = "(" + checkedSceneNames().length + " / " + selectable + " 件を選択";
  // 絞り込み中は「すべて ON」が何件に効くのかを数字で示す。隠れている
  // Scene の選択は残るため、選択数と表示数がずれることを前提に読ませる
  if (currentSceneFilter() !== "") text += " · 表示中 " + visibleSceneBoxes().length + " 件";
  byId("sceneCount").textContent = text + ")";
}

function currentSceneFilter() {
  return byId("sceneFilter").value.trim().toLowerCase();
}

/**
 * 一致しない行は DOM から消さずに hidden で隠す。checkedSceneNames() は
 * チェックボックスを直接読むため、消してしまうと絞り込んだ瞬間に隠れた
 * Scene の選択が保存内容から抜け落ちる。
 */
function applySceneFilter() {
  var needle = currentSceneFilter();
  var items = document.querySelectorAll("#sceneList li");
  var shown = 0;
  for (var i = 0; i < items.length; i += 1) {
    var matched = needle === "" || items[i].getAttribute("data-search").indexOf(needle) >= 0;
    items[i].hidden = !matched;
    if (matched) shown += 1;
  }
  var filtering = needle !== "";
  byId("selectAll").textContent = filtering ? "表示中をすべて ON" : "すべて ON";
  byId("selectNone").textContent = filtering ? "表示中をすべて OFF" : "すべて OFF";
  if (scenesLoaded && scenes.length > 0) {
    byId("sceneHint").textContent =
      filtering && shown === 0 ? "絞り込みに一致する Scene がありません。" : "";
  }
  updateSceneCount();
}

function renderScenes() {
  var list = byId("sceneList");
  list.textContent = "";
  var hint = byId("sceneHint");

  if (!scenesLoaded) {
    hint.textContent = "Unity プロジェクトのフォルダを指定すると Scene を一覧します。";
    applySceneFilter();
    return;
  }
  if (scenes.length === 0) {
    hint.textContent = "Assets フォルダに .unity ファイルが見つかりませんでした。パスを確認してください。";
    applySceneFilter();
    return;
  }
  hint.textContent = "";

  scenes.forEach(function (scene) {
    var item = document.createElement("li");
    // 絞り込みは Scene 名だけでなくパスにも当てる。SampleScene のように
    // 名前が同じ調子で並ぶプロジェクトでは、フォルダ名の方が効く
    item.setAttribute(
      "data-search",
      (scene.sceneName + " " + scene.assetPaths.join(" ")).toLowerCase()
    );
    var label = document.createElement("label");
    var box = document.createElement("input");
    box.type = "checkbox";
    box.className = "scene-check";
    box.value = scene.sceneName;
    box.disabled = !scene.selectable;
    box.checked = scene.selectable && savedSelection.indexOf(scene.sceneName) >= 0;
    box.addEventListener("change", function () {
      updateSceneCount();
      scheduleSave();
    });

    var body = document.createElement("span");
    var name = document.createElement("span");
    name.className = "scene-name";
    name.textContent = scene.sceneName;
    body.appendChild(name);

    var pathText = document.createElement("span");
    pathText.className = "scene-path";
    pathText.textContent = " " + scene.assetPaths.join(" / ");
    body.appendChild(pathText);

    if (!scene.selectable) {
      label.className = "disabled";
      var warn = document.createElement("span");
      warn.className = "scene-warn";
      warn.textContent = "同じ名前の Scene が複数あるため選択できません。どちらかの名前を変更してください。";
      body.appendChild(warn);
    }

    label.appendChild(box);
    label.appendChild(body);
    item.appendChild(label);
    list.appendChild(item);
  });
  applySceneFilter();
}

function loadScenes() {
  var projectPath = byId("projectPath").value.trim();
  if (projectPath === "") {
    scenes = [];
    scenesLoaded = false;
    renderScenes();
    return Promise.resolve();
  }
  byId("sceneHint").textContent = "Scene を読み込んでいます…";
  return api("/api/scenes", { method: "POST", body: JSON.stringify({ projectPath: projectPath }) })
    .then(function (body) {
      scenes = body.scenes;
      scenesLoaded = true;
      renderScenes();
      // 一覧に無い名前は落とし、表示と保存内容を一致させる
      savedSelection = checkedSceneNames();
      scheduleSave();
    })
    .catch(function (error) {
      scenes = [];
      scenesLoaded = false;
      renderScenes();
      byId("sceneHint").textContent = error.message;
    });
}

function setAllScenes(checked) {
  var boxes = visibleSceneBoxes();
  for (var i = 0; i < boxes.length; i += 1) {
    if (!boxes[i].disabled) boxes[i].checked = checked;
  }
  updateSceneCount();
  scheduleSave();
}

function showIssues(issues) {
  var list = byId("issues");
  list.textContent = "";
  (issues || []).forEach(function (issue) {
    var item = document.createElement("li");
    item.textContent = issue.message;
    list.appendChild(item);
  });
}

function appendLog(line) {
  var log = byId("log");
  var atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
  log.textContent += line + "\\n";
  if (atBottom) log.scrollTop = log.scrollHeight;
}

function setRunning(value) {
  running = value;
  byId("runCheck").disabled = value;
  byId("runRender").disabled = value;
  byId("pickProject").disabled = value;
  byId("pickOutput").disabled = value;
  byId("reloadScenes").disabled = value;
}

function start(mode) {
  showIssues([]);
  setRunStatus(mode === "check" ? "事前チェックを実行しています…" : "書き出しています…");
  setRunning(true);
  api("/api/run", { method: "POST", body: JSON.stringify({ mode: mode, state: collect() }) })
    .catch(function (error) {
      setRunning(false);
      setRunStatus("");
      showIssues(error.issues && error.issues.length ? error.issues : [{ message: error.message }]);
    });
}

function pickInto(inputId) {
  return function () {
    api("/api/pick-folder", { method: "POST", body: JSON.stringify({ startPath: byId(inputId).value }) })
      .then(function (body) {
        if (!body.path) return;
        byId(inputId).value = body.path;
        scheduleSave();
        if (inputId === "projectPath") {
          savedSelection = [];
          loadScenes();
        }
      })
      .catch(function (error) { setSaveStatus(error.message); });
  };
}

function applyState(state) {
  byId("projectPath").value = state.projectPath;
  byId("outputDirectory").value = state.outputDirectory;
  byId("fileName").value = state.fileName;
  byId("sceneFilter").value = state.sceneFilter;
  byId("width").value = state.resolution.width;
  byId("height").value = state.resolution.height;
  byId("frameRate").value = state.frameRate;
  savedSelection = state.selectedScenes;
  var boxes = document.querySelectorAll(".format-check");
  for (var i = 0; i < boxes.length; i += 1) {
    boxes[i].checked = state.formats.indexOf(boxes[i].value) >= 0;
  }
}

function connectEvents() {
  var source = new EventSource("/api/events?t=" + encodeURIComponent(TOKEN));
  source.onmessage = function (message) {
    var event = JSON.parse(message.data);
    if (event.type === "started") {
      byId("log").textContent = "";
      setRunning(true);
    } else if (event.type === "log") {
      appendLog(event.line);
    } else if (event.type === "finished") {
      setRunning(false);
      setRunStatus(event.exitCode === 0 ? "完了しました" : "失敗しました（ログを確認してください）");
    }
  };
}

function init() {
  var inputs = ["projectPath", "outputDirectory", "fileName", "width", "height", "frameRate"];
  inputs.forEach(function (id) { byId(id).addEventListener("input", scheduleSave); });
  var formatBoxes = document.querySelectorAll(".format-check");
  for (var i = 0; i < formatBoxes.length; i += 1) {
    formatBoxes[i].addEventListener("change", scheduleSave);
  }
  byId("projectPath").addEventListener("change", function () {
    savedSelection = checkedSceneNames();
    loadScenes();
  });
  byId("reloadScenes").addEventListener("click", function () {
    savedSelection = scenesLoaded ? checkedSceneNames() : savedSelection;
    loadScenes();
  });
  byId("sceneFilter").addEventListener("input", function () {
    applySceneFilter();
    scheduleSave();
  });
  byId("clearSceneFilter").addEventListener("click", function () {
    byId("sceneFilter").value = "";
    applySceneFilter();
    scheduleSave();
  });
  byId("pickProject").addEventListener("click", pickInto("projectPath"));
  byId("pickOutput").addEventListener("click", pickInto("outputDirectory"));
  byId("selectAll").addEventListener("click", function () { setAllScenes(true); });
  byId("selectNone").addEventListener("click", function () { setAllScenes(false); });
  byId("runCheck").addEventListener("click", function () { start("check"); });
  byId("runRender").addEventListener("click", function () { start("render"); });

  connectEvents();
  api("/api/state")
    .then(function (body) {
      applyState(body.state);
      setSaveStatus("前回の選択内容を読み込みました");
      return loadScenes();
    })
    .catch(function (error) { setSaveStatus(error.message); });
}

document.addEventListener("DOMContentLoaded", init);
`;

/** GUI 本体。外部 CDN を参照せず 1 ファイルで完結させる(オフライン運用のため)。 */
export function renderPage(token: string): string {
	return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Unity Render</title>
<style>${STYLES}</style>
</head>
<body>
<header>
  <h1>Unity Render</h1>
  <p>Scene を選んで動画を書き出します。</p>
</header>
<main>
  <section>
    <h2>1. Unity プロジェクト</h2>
    <div class="row">
      <input id="projectPath" class="grow" type="text" placeholder="D:\\path\\to\\unity-project" spellcheck="false">
      <button id="pickProject" type="button">参照…</button>
      <button id="reloadScenes" type="button">再読み込み</button>
    </div>
  </section>

  <section>
    <h2>2. 書き出す Scene <span id="sceneCount" class="count"></span></h2>
    <div class="row">
      <label class="field" for="sceneFilter">絞り込み</label>
      <input id="sceneFilter" class="grow" type="text" placeholder="Scene 名やフォルダ名の一部" spellcheck="false">
      <button id="clearSceneFilter" type="button">クリア</button>
    </div>
    <div class="row">
      <button id="selectAll" type="button">すべて ON</button>
      <button id="selectNone" type="button">すべて OFF</button>
    </div>
    <p class="hint">絞り込みは表示だけを変えます。ON / OFF は表示中の Scene にだけ効き、隠れている Scene の選択はそのまま残ります。</p>
    <p id="sceneHint" class="hint"></p>
    <ul id="sceneList" class="scenes"></ul>
  </section>

  <section>
    <h2>3. 出力設定</h2>
    <div class="row">
      <label class="field" for="outputDirectory">出力先</label>
      <input id="outputDirectory" class="grow" type="text" placeholder="D:\\path\\to\\renders" spellcheck="false">
      <button id="pickOutput" type="button">参照…</button>
    </div>
    <div class="row">
      <label class="field" for="fileName">ファイル名</label>
      <input id="fileName" type="text" class="grow" spellcheck="false">
    </div>
    <div class="row">
      <label class="field" for="width">解像度</label>
      <input id="width" type="number" min="1" max="16384">
      <span class="status">×</span>
      <input id="height" type="number" min="1" max="16384">
      <label class="field" for="frameRate">フレームレート</label>
      <input id="frameRate" type="number" min="1" max="1000" step="0.001">
    </div>
    <div class="row">
      <span class="field">形式</span>
      <label class="field"><input class="format-check" type="checkbox" value="mp4"> MP4 (H.264)</label>
      <label class="field"><input class="format-check" type="checkbox" value="mov-prores"> MOV (ProRes)</label>
    </div>
    <p class="hint">ファイル名に使える置き換え: &lt;Scene&gt; &lt;Take&gt; &lt;Recorder&gt; &lt;Resolution&gt; &lt;Frame Rate&gt; &lt;Date&gt; &lt;Time&gt; &lt;Project&gt;</p>
  </section>

  <section>
    <h2>4. 実行</h2>
    <div class="row">
      <button id="runCheck" type="button">事前チェック</button>
      <button id="runRender" type="button" class="primary">書き出し実行</button>
      <span id="runStatus" class="status"></span>
    </div>
    <ul id="issues" class="issues"></ul>
    <pre id="log" class="log"></pre>
    <p class="hint">書き出し中は Unity Editor が自動で起動します。対象プロジェクトを別の Editor で開いたままにしないでください。</p>
  </section>
</main>
<footer><span id="saveStatus">&nbsp;</span></footer>
<script>window.__GUI_TOKEN__ = ${JSON.stringify(token)};</script>
<script>${SCRIPT}</script>
</body>
</html>
`;
}

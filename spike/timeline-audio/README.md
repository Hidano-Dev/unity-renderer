# timeline-audio-remux 検証スパイク

Requirement 12（実装ゲート）に対応する検証記録。design.md「Research Needed / スパイク依存の暫定決定」の Q-1〜Q-11 を実 Unity 6 環境で実測し、GO/NO-GO を判定する。

> **実装ゲート**: 本文書に Q-1〜Q-11 の実測ログ・GO 判定・ユーザー承認が記録されるまで、tasks.md のタスク 2 以降に着手してはならない。

## 前提環境

| 項目 | 値 |
|---|---|
| Unity Editor | 6000.0.36f1（`spike/unity-project/ProjectSettings/ProjectVersion.txt` と一致） |
| Timeline | com.unity.timeline 1.7.7 |
| Recorder | com.unity.recorder 5.1.0 |
| Pipeline | com.unity.pipeline 0.5.0-exp.1（eval 経路。core スパイク P-1 で成立確認済み） |
| unity CLI | 1.0.0-beta.5 |
| ffmpeg | n8.1.2-44-g7c533d0f86 win64-lgpl（Q-8 で確定。下記マニフェスト参照） |
| 検証プロジェクト | `spike/unity-project/` |
| 実測日 | 2026-08-23 |

Editor の起動と eval 送信は core スパイク（`spike/README.md`）で確立した経路をそのまま使う。`spike/AGENTS.md` のダイアログ回避ルール（バージョン固定・`-automated`・二重起動禁止）に従うこと。

```powershell
# 起動
unity open "<repo>\spike\unity-project" --editor-version 6000.0.36f1 --args "-automated" --non-interactive
# 疎通確認（state: ready になるまで待つ）
unity status --format json
# C# ペイロード送信
unity command eval_file --project-path "<repo>\spike\unity-project" "<repo>\spike\timeline-audio\tools\<name>.cs" --timeout 180 --format json
```

## eval ペイロードの形式制約（実測）

これは design の前提に直接影響するため最初に記録する。

`unity command eval` / `eval_file` に渡す C# は、Editor 側で

```csharp
static class PipelineEval_<hash> { public static object Execute() { /* 渡したコード */ } }
```

に相当する形へ包まれる。したがって:

- **usings は書けない。完全修飾名を使う**（`UnityEditor.AssetDatabase...`）。
- **ローカル関数は使える**。core の既存ペイロードも同形式。
- **メソッド本体なので型宣言はできない**。`[System.Serializable] class Foo {...}` を素で書くと `The modifier 'public' is not valid for this item` 等でコンパイル失敗する。
- 波括弧を自前で閉じて `} class Foo {...} static object Unused() {` と書く「脱出」は**コンパイル自体は通る**が、そうして宣言した型は Unity のシリアライザから見えず、後述の Q-6 のとおり JsonUtility で落ちる。

## 検証用アセット

### 生成手順（再現可能）

```powershell
# 1. 音源フィクスチャ（WAV）を生成
powershell -ExecutionPolicy Bypass -File spike\timeline-audio\tools\gen-audio.ps1

# 2. Timeline / Scene を構築
unity command eval_file --project-path <proj> <tools>\build-fixtures.cs --timeout 180 --format json

# 3. 抽出経路で読み戻して検証
unity command eval_file --project-path <proj> <tools>\verify-fixtures.cs --timeout 180 --format json

# 4. Q-5 用の音源形式カバレッジ（mp3 / ogg / Packages / サブアセット）
unity command eval_file --project-path <proj> <tools>\build-source-fixtures.cs --timeout 180 --format json

# 5. Q-6 用の大規模 Timeline + atomic write
unity command eval_file --project-path <proj> <tools>\stress-extract.cs --timeout 300 --format json

# 6. Unity 基準音の収録（2 段。stage 2 は Play Mode 遷移完了まで再試行する）
unity command eval_file --project-path <proj> <tools>\audio-capture-setup.cs --timeout 120 --format json
unity command eval_file --project-path <proj> <tools>\audio-capture-start.cs --timeout 300 --format json
# 7. 実 Recorder の無音映像（MP4 / MOV ProRes）
unity command eval_file --project-path <proj> <tools>\audio-capture-setup.cs --timeout 120 --format json
unity command eval_file --project-path <proj> <tools>\video-capture-start.cs  --timeout 600 --format json
```

`build-fixtures.cs` は冪等（既存アセットを削除して再構築）。

> **落とし穴（実測で踏んだ）**: 構築の途中で `AssetDatabase.SaveAssets()` / `Refresh()` を呼ぶと dirty な `.playable` が再インポートされ、保持中のトラック／クリップ sub-asset が destroy される（`The object of type 'UnityEngine.Timeline.ControlTrack' has been destroyed`）。**Scene と PlayableDirector を先に作り、保存は最後に 1 回だけ**という順序を崩さないこと。

> **embedded package の反映**: `Packages/<name>/` を新規に置いた直後は `AssetDatabase.Refresh()` だけでは解決されない。`UnityEditor.PackageManager.Client.Resolve()` は非同期なので、**別の eval 呼び出しに分けて**から参照する。

### 音源フィクスチャ（`spike/unity-project/Assets/Audio/`）

| ファイル | サンプルレート | ch | 長さ | 用途 |
|---|---|---|---|---|
| `click_48k_st_1s.wav` | 48000 | 2 | 1.0 s | 0.0 / 0.25 / 0.5 / 0.75 s に 5 ms クリック。同期精度測定 |
| `tone440_44k_st_2s.wav` | 44100 | 2 | 2.0 s | 440 Hz。**リサンプリング経路**の検証 |
| `tone880_48k_mono_3s.wav` | 48000 | 1 | 3.0 s | 880 Hz。**モノラル → ステレオ正規化**の検証 |
| `beep1k_48k_st_0p5s.wav` | 48000 | 2 | 0.5 s | 1 kHz。**ループ折り返し**の検証 |
| `tone440_44k_st_2s.mp3` | 44100 | 2 | 2.0 s | Q-5 の .mp3 経路（ffmpeg で生成） |
| `tone880_48k_mono_3s.ogg` | 48000 | 1 | 3.0 s | Q-5 の .ogg 経路（ffmpeg で生成） |
| `Packages/com.spike.audio/Runtime/Audio/pkg_beep_0p5s.wav` | 48000 | 2 | 0.5 s | Q-5 の `Packages/...` パス形式 |
| `Assets/Audio/SubAssetContainer.asset` 内 AudioClip | 48000 | 2 | 0.5 s | Q-5 の**ファイル実体を持たない参照** |

### Timeline / Scene 構成

- Scene: `Assets/Scenes/AudioSpike.unity`
  - `Root` (PlayableDirector) → `Assets/Timeline/AudioSpikeRoot.playable`
  - `NestedL1` / `NestedL2` (PlayableDirector) → 各ネスト Timeline
  - `MainCamera` — Camera + **AudioListener**（これが無いと Unity の音声出力に何も届かず Recorder が無音を録る）
  - `DecoyAudioSource` — Scene 直置き AudioSource。**抽出対象に含まれてはならない**囮
- フレームレート 30 fps / ルート長 21.0 s
- Q-5 用: `Assets/Scenes/AudioSpikeSources.unity` + `Assets/Timeline/AudioSpikeSources.playable`
- Q-6 用: `Assets/Timeline/AudioSpikeStress.playable`（10 トラック × 15 クリップ = 150 クリップ）

`AudioSpikeRoot.playable`:

| トラック | クリップ | start | duration | clipIn | timeScale | loop | クリップ音量 | トラック音量 | 検証観点 |
|---|---|---|---|---|---|---|---|---|---|
| `A_Simple` | click | 0.0 | 1.0 | 0 | 1.0 | – | 1.0 | 1.0 | 基準 |
| `G_Group/A_InGroup` | tone440 | 1.0 | 2.0 | 0 | 1.0 | – | **0.5** | **0.8** | GroupTrack 配下・音量畳み込み・44.1 kHz |
| `G_Group/A_Muted` | tone880 | 1.0 | 3.0 | 0 | 1.0 | – | 1.0 | 1.0 | **ミュートトラック**（除外されること） |
| `A_Overlap` | tone880 | 1.5 | 3.0 | 0 | 1.0 | – | **0.25** | 1.0 | `A_InGroup` と**重なり**・モノラル |
| `A_Speed` | tone440 | 5.0 | 1.0 | **0.25** | **2.0** | – | 1.0 | 1.0 | **変速 + clipIn** |
| `A_Loop` | beep(0.5s) | 8.0 | 2.5 | 0 | 1.0 | **true** | 1.0 | 1.0 | **ループ 5 回折り返し** |
| `A_Composite` | beep(0.5s) | 18.0 | 3.0 | **0.125** | **1.5** | **true** | **0.75** | 1.0 | **必須複合ケース**: ループ × 変速 × clipIn |
| `C_Nested` | `ToNestedL1` | 11.0 | 4.0 | 0 | **0.5** | – | – | – | ネスト 1 段目 |
| `C_Nested` | `BrokenRef` | 16.0 | 2.0 | 0 | 1.0 | – | – | – | **参照切れ ControlClip** |

`AudioSpikeNestedL1.playable`: `L1_Audio`(click, 0.0, 1.0) / `L1_Control` → `ToNestedL2`(start 1.0, dur 2.0, **timeScale 2.0**)
`AudioSpikeNestedL2.playable`: `L2_Audio`(tone440, 0.0, 1.0, **clipIn 0.5**)

### 時間換算の期待値（Q-10 の照合基準）

```
root_time = offset + local_time / speed

ControlClip（local start S / clipIn cin / timeScale TS）を持つ
(offset, speed) のタイムラインに対して:
  R_S     = offset + S / speed
  speed'  = speed * TS
  offset' = R_S - cin / speed'
  子の可視窓 = [R_S, R_S + duration / speed]
```

| クリップ | ルート基準 start | 実効再生速度 | 実測 |
|---|---|---|---|
| `L1_Audio` | 11.0 | 0.5 | **一致** |
| `L2_Audio` | 13.0 | 1.0 | **一致**（再生音 440 Hz で確認 = 速度 0.5 × 2.0 = 1.0） |

## 検証結果 Q-1〜Q-11

### Q-1 全階層 AudioTrack の列挙 — **成立**

`verify-fixtures.cs` で `clipCount: 9`、`errors: []`。

- `TimelineAsset.GetOutputTracks()` が **GroupTrack 配下の AudioTrack を平坦化して返す**（`G_Group/A_InGroup`, `G_Group/A_Muted`）。GroupTrack を自前で降りる必要はない。
- `ControlPlayableAsset.sourceGameObject.Resolve(owner)` が **eval コンテクストで動作する**。`owner` は各階層の PlayableDirector（root → L1 → L2 と受け渡す）。
- 参照切れ ControlClip は `Resolve()` が **null を返す（例外ではない）**。warning + subtree スキップで処理できる。
- Scene 直置きの `DecoyAudioSource` は TimelineAsset 起点の走査に**一切現れない**。走査起点をトラック列挙に限定すれば構造的に保証される。

フォールバック不要。

### Q-2 クリップ属性一式 — **成立**

`TimelineClip.start / duration / clipIn / timeScale`、`AudioPlayableAsset.clip / loop` は設定値がそのまま読み戻せた（上表と完全一致）。

**ループの実挙動**は Unity 実再生音の収録で確認した:

- `A_Loop`（0.5 s 音源 / クリップ長 2.5 s / loop=true）→ 8.05–10.40 s の全域で 1000 Hz が連続。**折り返して 5 回再生される**。
- `A_Composite`（0.5 s 音源 / 3.0 s / speed 1.5 / loop=true）→ 18.05–20.90 s で 1500.4 Hz が連続。**ループと変速が同時に効く**。

### Q-3 クリップ音量 — **成立（fallback を正式採用）**

公開 API は**存在しない**。`SerializedObject` の **`m_ClipProperties.volume`** で読み書きが成立（0.5 / 0.25 / 0.75 を往復確認）。設計のフォールバック経路をそのまま正式経路に昇格する。

### Q-4 トラック音量・階層ミュート — **成立（fallback を正式採用）**

- トラック音量: 公開 API なし。`SerializedObject` の **`m_TrackProperties.volume`** で成立（0.8 → 読み戻し 0.800000011920929、float 精度どおり）。
- ミュート伝搬: `mutedInHierarchy` 相当の公開 API は見当たらず、**`TrackAsset.muted` + `TrackAsset.parent` を祖先方向に走査**して判定する方式で成立（`A_Muted` → `mutedBy: "A_Muted"`）。
- **ミュートが実際に音を落とすことを収録で確認**: `A_Muted`（tone880, 1.0–4.0）と `A_Overlap`（tone880, 1.5–4.5, clipVol 0.25）が重なる区間で、3.10–4.40 s のピークは 0.0899 = 音源 0.5 × 0.25 × モノラル -3 dB の**ちょうど 1 本ぶん**。ミュートトラックは鳴っていない。

音量は `float` なので JSON に出す値は float 精度の double になる（例 `0.20000000298023224`）。TS 側はこれを許容すること。

### Q-5 元ファイルの絶対パス解決 — **成立**

| ケース | assetPath | 絶対パス解決 | 判定 |
|---|---|---|---|
| .wav（Assets） | `Assets/Audio/click_48k_st_1s.wav` | `Path.GetFullPath` で成立 | `fileExists: true` |
| .mp3（Assets） | `Assets/Audio/tone440_44k_st_2s.mp3` | 成立 | `fileExists: true` |
| .ogg（Assets） | `Assets/Audio/tone880_48k_mono_3s.ogg` | 成立 | `fileExists: true` |
| .wav（embedded package） | `Packages/com.spike.audio/...` | 成立 | `fileExists: true` |
| .md（registry package） | `Packages/com.unity.timeline/CHANGELOG.md` | **`Library/PackageCache/com.unity.timeline@<hash>/...` に解決** | `fileExists: true` |
| AudioClip サブアセット | `Assets/Audio/SubAssetContainer.asset` | `.asset` を指す | `isSubAsset: true`, `isMainAsset: false` |

**`Path.GetFullPath("Packages/...")` は registry package（物理的には `Library/PackageCache/` 配下）も正しく解決する** — Editor が IO 層で remap しているため。`PackageManager.PackageInfo.FindForAssetPath(...).resolvedPath` と結果が一致したので、設計のフォールバック（Packages 専用の解決経路追加）は**不要**。

ファイル実体を持たない参照は **`AssetDatabase.IsSubAsset()` が true** かつ拡張子が音声形式でないことで検出できる。これを error として記録する。

> **注意（mp3）**: `AudioClip.length` は **2.0637 s**（元ファイルは 2.0 s）。MP3 のエンコーダ遅延／パディングぶんが含まれる。音源長を `AudioClip.length` から取ると ffmpeg のデコード長と 64 ms ずれる。**音源長は ffprobe 側の値を正とし、`AudioClip.length` は参考値に留める**こと。

### Q-6 抽出 JSON の生成方式 — **不成立 → フォールバック採用**

**JsonUtility + `[Serializable]` DTO は eval ペイロードでは使えない。**

| 型 | JsonUtility の結果 |
|---|---|
| `int` / `float` / `double` / `string` | **成功**（`13.000000000000002`、`1e-7` まで精度保持） |
| `string[]` / `double[]` | **成功** |
| カスタム型フィールド（`Child one`） | **消える**（`{}`） |
| カスタム型配列（`Child[]`） | **消える** |
| `List<Child>` | **消える** |

音声メタデータはクリップの配列が必須なので、この時点で JsonUtility は要件を満たさない。原因は前述の形式制約（型を宣言するには波括弧脱出が必要で、そうして宣言した型は Unity のシリアライザから見えない）。

→ **設計のフォールバック「手書き JSON ライタ（StringBuilder）」を正式採用する。** double は `ToString("R", CultureInfo.InvariantCulture)` で round-trip 可能な表現になる。

**規模と atomic write の実測**（`stress-extract.cs`、150 クリップ / 10 トラック）:

| 項目 | 実測値 |
|---|---|
| Timeline 構築 | 73 ms |
| 走査 + JSON 直列化 | **4 ms** |
| ファイル書き込み | 0 ms |
| 合計 | 79 ms |
| JSON サイズ | **51,976 bytes**（150 クリップ） |
| temp → rename | 成功（temp 消滅・final 存在を確認） |
| 生成 JSON | `ConvertFrom-Json` でパース成功、150 クリップ |

規模は問題にならない（1 クリップあたり約 346 bytes / 0.03 ms）。

> **atomic write の実装**: 本スパイクの計測では `File.Delete` + `File.Move` を使ったが、**core の既存ペイロードと同じく `File.Replace(temp, dst, null)` を使うこと**。Unity の C# プロファイルには `File.Move(src, dst, overwrite)` が無く、delete + move には削除と rename の間の隙間があるため。

### Q-7 変速時のピッチ挙動 — **確定: `pitchMode: "resample"`**

Unity 実再生音の収録から:

| クリップ | 音源 | 速度 | 収録音の基本周波数 | 判定 |
|---|---|---|---|---|
| `A_Speed` | 440 Hz | 2.0 | **880 Hz** | ピッチが速度比で変動 |
| `A_Composite` | 1000 Hz | 1.5 | **1500.4 Hz** | 同上 |
| `L2_Audio` | 440 Hz | 0.5 × 2.0 = 1.0 | **440 Hz** | 累積速度 1.0 で不変 |

**Unity は変速時にリサンプリングする（ピッチが変わる）。** design の暫定値 `pitchMode: "resample"`（`asetrate` + `aresample`）が正しい。

ffmpeg 側も期待どおり（880 Hz 音源を 2 倍速）:

| フィルタ | 出力周波数 | 出力長（3.0 s 音源 2 倍速） |
|---|---|---|
| `asetrate` + `aresample` | 1760 Hz | **1.500000 s（厳密）** |
| `atempo=2.0` | 879.8 Hz | 1.504896 s（**+0.33%**） |

> **`atempo` の時間ドリフト（重要）**: `atempo` は速度 0.5 / 1.5 / 2.0 で **-0.26% / +0.12% / +0.33%** の長さ誤差を出す（0.5 s のクリック列では **-2.4%**）。30 fps の 0.5 フレーム = 16.7 ms に対し、長尺クリップでは容易に超える（0.33% なら 60 s で 198 ms）。
> `asetrate` は全速度でサンプル厳密だった。**将来 `preserve-pitch` を実装する場合は、`atempo` の後に `atrim=end_sample=N` + `apad` で長さを強制する処理を必須にする**こと。

### Q-8 ffmpeg ビルドの確定 — **確定**

> **`latest` タグは使えない**: BtbN の `latest` リリースは**資産が差し替わるローリングタグ**で、SHA-256 のピン止めが成立しない。**日付入りの恒久タグ `autobuild-YYYY-MM-DD-HH-MM` を使う。**

**FfmpegManifest 確定値**:

| 項目 | 値 |
|---|---|
| buildId | `ffmpeg-n8.1.2-44-g7c533d0f86-win64-lgpl-8.1` |
| リリースタグ | `autobuild-2026-08-22-12-58` |
| URL | `https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-08-22-12-58/ffmpeg-n8.1.2-44-g7c533d0f86-win64-lgpl-8.1.zip` |
| SHA-256 | `aa5ff0d7bfc091f9a43d43f7af4a2174294edacf5cdc5fff031819a5eaa763c7` |
| サイズ | 146,078,688 bytes |
| ライセンス | **LGPL v3**（`--enable-version3`、`--enable-gpl` / `--enable-nonfree` なし、`--disable-libx264` / `--disable-libx265`） |
| 同梱 | `bin/{ffmpeg,ffprobe,ffplay}.exe`（静的）、`LICENSE.txt`（LGPL v3 全文）、`doc/`、`presets/` |
| ダウンロード実測 | 8.2 秒 |

**必要フィルタ / エンコーダの動作確認**（すべて OK）: `amix` `adelay` `atrim` `asetrate` `atempo` `aresample` `aformat` `apad` `volume` `aloop` `anull` / `aac` `pcm_s24le` `pcm_s16le`

**フィルタ挙動の実測**:

| 検証項目 | 結果 |
|---|---|
| `adelay=12000S`（サンプル指定） | クリックが厳密に +0.25 s、出力長 1.250000 s。**サンプル厳密** |
| `amix=normalize=0` | 同一入力 3 本で **+3.52 dBFS = 厳密に 3 倍**。**純粋な加算** |
| `amix=normalize=1` | 同一入力 3 本で -6.02 dBFS = **sum/N**。絶対レベルが壊れるので**使用不可** |
| ループ折り返し | `-stream_loop -1` + `atrim=end=2.5` / `aloop=-1:size=N` + `atrim` ともに **2.5 s 厳密** |
| 長さ強制 | `apad,atrim=end_sample=120000` で **2.5 s 厳密** |
| モノラル → ステレオ | `aformat channel_layouts=stereo` / `aresample ochl=stereo` はいずれも **-3.01 dB**。`pan=stereo\|c0=c0\|c1=c0` はレベル保持 |
| クリッピング | float32 中間出力は **+5.1 dBFS のヘッドルームを保持**、int16 出力で 0 dBFS にクリップ。設計どおり |

> **モノラル → ステレオは `aformat` を使う（`pan` ではない）**: 当初「`aformat` の -3 dB は Unity と食い違うので `pan` を使うべき」と考えたが、**Unity 側も同じ -3.01 dB を適用していた**（Q-11 参照）。`pan` を使うと ffmpeg 側が 3 dB 大きくなり不一致になる。

**filter script のサイズ**: 8 クリップで 1,280 bytes。150 クリップなら約 24 KB で、Windows のコマンドライン長制限（約 8,191 文字）を超える。**`-filter_complex_script` によるスクリプトファイル渡しは必須**。

### Q-9 実 Recorder 出力への mux — **成立**

`video-capture-start.cs` で実 Recorder の無音映像を取得（640×360 / 30 fps / 630 フレーム、収録所要 21.15 秒）:

| 出力 | コーデック | サイズ | 映像長 |
|---|---|---|---|
| `video-silent-mp4.mp4` | h264 | 24,283 bytes | 21.000000 s / 630 フレーム |
| `video-silent-mov.mov` | prores | 1,895,329 bytes | 21.000000 s / 630 フレーム |

mux 結果（`-c:v copy` + コーデックマトリクス）:

| 出力 | 音声コーデック | mux 所要 | 映像長 | 音声長 | 差 |
|---|---|---|---|---|---|
| `muxed-exact.mp4` | aac 48 kHz stereo（+faststart） | **0.19 s** | 21.000000 | 21.000000 | **0.000 フレーム** |
| `muxed-exact.mov` | pcm_s24le 48 kHz stereo | **0.03 s** | 21.000000 | 21.000000 | **0.000 フレーム** |

**コーデックマトリクス（MP4 → AAC 48 kHz / MOV(ProRes) → PCM 24bit）は実出力で成立。`-c:v copy` は両コンテナで問題なし。**

> **目標サンプル数は映像長から導出すること**: 最初は Unity の音声収録長（20.992 s = 1,007,616 サンプル）に合わせたため差が 0.008 s（0.24 フレーム）残った。`atrim=end_sample=` を **映像長 × 48000**（21.0 × 48000 = 1,008,000）にすると**差 0.000000 s** になる。requirement 7.4 の許容誤差は余裕を持って満たせる。

**タイムアウト係数**: 21 秒の映像に対し実 mux は 0.19 秒 / 0.03 秒（約 0.01 倍）。design の暫定式 `ceil(outDur × 2) + 120` 秒は十分すぎるほど保守的なので**そのまま採用**して差し支えない。

### Q-10 時間正規化の実挙動一致 — **部分成立（要追加検証）**

**式の構造は確認できた**:

- `L2_Audio` の再生音が 440 Hz → 実効速度 0.5 × 2.0 = **1.0 が正しい**（累積が乗算であることの直接証拠）
- ネスト内クリック列の間隔が 0.5 s（音源 0.25 s ÷ 速度 0.5）→ **実効速度 0.5 が正しい**
- ffmpeg 側で同じ式から生成したミックスのオンセットは公称位置と**最大 7 サンプル（0.15 ms）差**

**しかし Unity 収録音の絶対位置は公称値からずれる**:

| イベント | 公称 | ffmpeg ミックス | Unity 収録 | Unity のずれ |
|---|---|---|---|---|
| click 2 / 3 / 4（`A_Simple`） | 0.25 / 0.50 / 0.75 | 0.250000 / 0.500000 / 0.750000 | 0.271333 / 0.520646 / 0.771333 | **+21 ms** |
| `A_InGroup` 開始 | 1.000 | 1.000042 | 0.984062 | **-16 ms** |
| `A_Speed` 開始 | 5.000 | 5.000021 | 4.986521 | -13 ms |
| `A_Loop` 開始 | 8.000 | 8.000021 | 7.988333 | -12 ms |
| `L1_Audio` 開始 | 11.000 | 11.000000 | 10.986688 | -13 ms |
| ネスト内 click 2–4 | 11.5 / 12.0 / 12.5 | 11.499854 / 11.999854 / 12.499854 | 11.443979 / 11.942625 / 12.443979 | **-56 ms** |
| `L2_Audio` 開始 | 13.000 | 13.000021 | 12.943979 | -56 ms |
| `A_Composite` 開始 | 18.000 | 18.000021 | 17.998375 | -2 ms |

2 回の収録で**オンセットは ±5 ms 以内で再現**したため、ランダムな録音ジッタではなく**決定的なずれ**である。ただし発生源が Timeline の音声スケジューリングなのか Recorder の音声収録経路なのかは**本スパイクでは切り分けていない**。ずれ幅は 0.5 フレーム（16.7 ms @30 fps）を超える。

**扱い**: 式（design ステップ 1–2）を変更する根拠は無い（構造は上記のとおり検証済みで、ffmpeg 側は厳密）。ただし **requirement 7.4 の許容誤差を「Unity 実再生音との一致」で測ることはできない**。タスク 6.1 の同期精度 E2E は、**ffmpeg 出力のクリック位置が計画値と一致すること**（これは実測済みで厳密）を判定基準とし、Unity 収録音との比較は参考値に留めるべき。発生源の切り分けはタスク 6.1 で行う。

### Q-11 ミックス同等性 — **成立（`amix=normalize=0` を採用）**

同一フィクスチャについて、Unity 実再生音の収録（`unity-reference.wav`）と、同じ MixPlan から生成した ffmpeg ミックス（`ffmpeg-mix.wav`）を区間ごとに比較した。

**RMS 比較（頑健な指標）**:

| 区間 | Unity RMS | ffmpeg RMS | 差 |
|---|---|---|---|
| `A_InGroup` 440 Hz | 0.142839 | 0.141416 | **+0.087 dB** |
| 重なり（440 + 880） | 0.156118 | 0.154611 | **+0.084 dB** |
| `A_Overlap` 880 Hz（モノラル） | 0.063086 | 0.062498 | **+0.081 dB** |
| `A_Speed`（440 × 2.0） | 0.357005 | 0.353548 | **+0.085 dB** |
| `A_Loop`（1 kHz ループ） | 0.429871 | 0.424248 | **+0.114 dB** |
| `L2_Audio` 440 Hz（ネスト） | 0.356996 | 0.353541 | **+0.085 dB** |
| `A_Composite`（ループ×変速） | 0.322062 | 0.318192 | **+0.105 dB** |
| ネスト内クリック列 | 0.062631 | 0.066373 | -0.504 dB |

**トーン区間はすべて 0.09〜0.11 dB 以内で一致。重なり区間も同様**。加算ミックス（`amix=normalize=0`）が Unity の挙動と等価であることが確認できた。

**ゲインモデルの確認**（絶対値でも一致）:

| 区間 | 期待値 | Unity ピーク | 判定 |
|---|---|---|---|
| `A_InGroup` | 0.5(音源) × 0.5(クリップ音量) × 0.8(トラック音量) = **0.20** | 0.203014 | **クリップ音量 × トラック音量の乗算で正しい** |
| `A_Overlap` | 0.5 × 0.25 × 0.7071(モノラル→ステレオ) = **0.0884** | 0.089942 | **Unity もモノラルを -3.01 dB する** |
| `A_Composite` | 0.6 × 0.75 = **0.45** | 0.458267 | 一致 |

**ビット一致は原理的に不可能**（3 つの独立した理由）:

1. **Unity の既定 AudioImporter は .wav でも Vorbis に再エンコードする**（`compressionFormat: Vorbis`, `quality: 1.0`）。Unity は非可逆デコード後の波形を鳴らし、ffmpeg は元の PCM を読む。
2. **Unity 自身の出力がラン間でサンプル一致しない**。同一構成で 2 回収録した波形の最大差は 1.004（フルスケール）、RMS 差 -12.96 dBFS。880 Hz 成分が約 27 サンプル（0.57 ms）位相ずれしていた。
3. ffmpeg のリサンプラは鋭い過渡音でオーバーシュートする。0.5 倍速のクリック列でピーク **1.166**（Unity は 0.911、音源は 0.9）。整数 PCM で出力すればクリップする値。

**したがって Q-11 の同等性基準は「区間 RMS の一致（≤ 0.5 dB）」とすべきで、サンプル一致やピーク一致で判定してはならない。** ピークは重なり区間の位相関係に左右され（ffmpeg 0.2499 / Unity 0.2906、+1.31 dB）、指標として不適切。

> **過渡音のオーバーシュートは実装上の注意点**: 中間処理が float なので mux 前にクリップしないが、最終エンコード（AAC / PCM）で 0 dBFS を超える成分は歪む。素材のピークが高い場合に顕在化しうる。

## Q 別ステータス一覧

| ID | ステータス | 採用経路 |
|---|---|---|
| Q-1 | **成立** | `GetOutputTracks()` + `sourceGameObject.Resolve(owner)`。フォールバック不要 |
| Q-2 | **成立** | 公開 API そのまま。ループ実挙動も収録で確認 |
| Q-3 | **成立（fallback 採用）** | `SerializedObject("m_ClipProperties.volume")` |
| Q-4 | **成立（fallback 採用）** | `SerializedObject("m_TrackProperties.volume")` + `parent` 祖先走査 |
| Q-5 | **成立** | `AssetDatabase.GetAssetPath` + `Path.GetFullPath`。Packages 専用処理は不要。サブアセットは `IsSubAsset` で検出 |
| Q-6 | **不成立 → fallback 採用** | JsonUtility 不可。手書き JSON ライタ（StringBuilder）+ `File.Replace` |
| Q-7 | **確定** | `pitchMode: "resample"`（`asetrate` + `aresample`） |
| Q-8 | **確定** | BtbN `autobuild-2026-08-22-12-58` / n8.1.2 win64-lgpl / SHA-256 上記 |
| Q-9 | **成立** | `-c:v copy` + MP4→AAC / MOV→pcm_s24le。ストリーム長差 0.000 フレーム |
| Q-10 | **部分成立** | 式は変更不要。ただし Unity 収録音との絶対位置比較は判定基準に使えない（下記 GO 条件参照） |
| Q-11 | **成立** | `amix=normalize=0`。同等性基準は区間 RMS ≤ 0.5 dB |

## GO/NO-GO 判定

**判定: GO（条件付き）**

- **Q-1〜Q-6（抽出成立性）**: すべて実装可能な経路が確定した。Q-3 / Q-4 / Q-6 はフォールバック経路の採用で成立。**NO-GO 条件には該当しない。**
- **Q-11（design 確定の NO-GO ゲート）**: `amix=normalize=0` の同等性を実測で確認した。**ゲート通過。** ただし同等性の判定基準を「サンプル/ピーク一致」から「区間 RMS ≤ 0.5 dB」へ変更して design に反映する。
- **Q-7 / Q-8 / Q-9**: 暫定値をすべて実測値で確定した。

**条件（実装前に design へ反映すること）**:

1. **Q-6 の方式変更**: 抽出 JSON は JsonUtility ではなく手書き JSON ライタで生成する（design の「第一候補」を差し替え）。
2. **Q-8 の FfmpegManifest 定数**を上表の値で確定し、恒久タグを使う旨を明記する。
3. **Q-11 の同等性基準**を区間 RMS ベースに書き換える。ビット一致が不可能な理由（Vorbis 再インポート・Unity 出力の非再現性・リサンプラのオーバーシュート）を根拠として残す。
4. **モノラル → ステレオは `aformat` を使う**（`pan` ではない）ことを filter graph の節に明記する。
5. **最終出力のサンプル数は映像長 × 48000 から導出する**ことを明記する。
6. **`atempo` を使う場合は長さ強制（`atrim=end_sample` + `apad`）が必須**である旨を `preserve-pitch` の節に追記する。
7. **音源長は ffprobe の値を正とする**（`AudioClip.length` は mp3 でパディングを含む）。

**残課題（後続タスクで扱う）**:

- **Q-10 の絶対位置ずれの発生源切り分け**（Timeline の音声スケジューリング / Recorder の音声収録経路）。タスク 6.1 で実施する。本スペックの実装（ffmpeg 側）は式どおりで厳密なので、実装をブロックしない。

**ユーザー承認: 未取得。**

## ツール

| ファイル | 用途 |
|---|---|
| `tools/gen-audio.ps1` | 決定的な WAV フィクスチャを生成する |
| `tools/build-fixtures.cs` | Timeline / Scene のフィクスチャを構築する eval ペイロード（冪等） |
| `tools/verify-fixtures.cs` | 抽出経路と同じ走査でフィクスチャを読み戻し JSON で出力する |
| `tools/build-source-fixtures.cs` | Q-5 用の音源形式カバレッジ（mp3 / ogg / Packages / サブアセット） |
| `tools/stress-extract.cs` | Q-6 用の 150 クリップ Timeline + 手書き JSON + atomic write |
| `tools/audio-capture-setup.cs` | Unity 基準音収録の stage 1（Scene を開き Play Mode へ） |
| `tools/audio-capture-start.cs` | stage 2（Recorder の AudioRecorderSettings で WAV 収録） |
| `tools/video-capture-start.cs` | 実 Recorder の無音 MP4 / MOV(ProRes) 収録（Q-9 用） |
| `tools/analyze-wav.ps1` | サンプル単位のオンセット / 区間 RMS・ピーク・基本周波数 / 波形比較 |
| `tools/build-ffmpeg-mix.ps1` | フィクスチャの MixPlan から ffmpeg ミックスを生成する（比較の対向側） |

> **`analyze-wav.ps1` の注意**: 解析用のモノラル化に **`-ac 1` を使ってはならない**。ffmpeg のステレオ→モノラル行列は正規化されており、左右同一の信号を √2（+3.01 dB）倍する。全ピーク値が一律に膨らむ（この誤りを実際に踏んだ）。`pan=mono|c0=c0` でチャンネル 0 をそのまま取ること。

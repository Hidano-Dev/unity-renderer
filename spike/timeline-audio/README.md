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
| 検証プロジェクト | `spike/unity-project/` |

Editor の起動と eval 送信は core スパイク（`spike/README.md`）で確立した経路をそのまま使う。`spike/AGENTS.md` のダイアログ回避ルール（バージョン固定・`-automated`・二重起動禁止）に従うこと。

```powershell
# 起動
unity open "<repo>\spike\unity-project" --editor-version 6000.0.36f1 --args "-automated" --non-interactive
# 疎通確認（state: ready になるまで待つ）
unity status --format json
# C# ペイロード送信
unity command eval_file --project-path "<repo>\spike\unity-project" "<repo>\spike\timeline-audio\tools\<name>.cs" --timeout 180 --format json
```

## 検証用アセット

### 生成手順（再現可能）

```powershell
# 1. 音源 WAV フィクスチャを生成（決定的・リポジトリ外部依存なし）
powershell -ExecutionPolicy Bypass -File spike\timeline-audio\tools\gen-audio.ps1

# 2. Editor を起動して Timeline / Scene を構築
unity command eval_file --project-path "<repo>\spike\unity-project" "<repo>\spike\timeline-audio\tools\build-fixtures.cs" --timeout 180 --format json

# 3. 抽出経路で読み戻して構成を検証
unity command eval_file --project-path "<repo>\spike\unity-project" "<repo>\spike\timeline-audio\tools\verify-fixtures.cs" --timeout 180 --format json
```

`build-fixtures.cs` は冪等（既存アセットを削除して再構築）。**注意**: 構築の途中で `AssetDatabase.SaveAssets()` / `Refresh()` を呼ぶと dirty な `.playable` が再インポートされ、保持中のトラック／クリップ sub-asset が destroy される。Scene と PlayableDirector を先に作り、保存は最後に 1 回だけ行う順序を崩さないこと（実測で `ControlTrack has been destroyed` エラーを踏んだ）。

### 音源フィクスチャ（`spike/unity-project/Assets/Audio/`）

| ファイル | サンプルレート | ch | 長さ | 用途 |
|---|---|---|---|---|
| `click_48k_st_1s.wav` | 48000 | 2 | 1.0 s | 0.0 / 0.25 / 0.5 / 0.75 s に 5 ms クリック。同期精度測定（タスク 6.1） |
| `tone440_44k_st_2s.wav` | 44100 | 2 | 2.0 s | 440 Hz。**リサンプリング経路**（48 kHz 正規化）の検証 |
| `tone880_48k_mono_3s.wav` | 48000 | 1 | 3.0 s | 880 Hz。**モノラル → ステレオ正規化**の検証 |
| `beep1k_48k_st_0p5s.wav` | 48000 | 2 | 0.5 s | 1 kHz。クリップ長 > 音源長の**ループ折り返し**の検証 |

### Timeline / Scene 構成

- Scene: `spike/unity-project/Assets/Scenes/AudioSpike.unity`
  - `Root` (PlayableDirector) → `Assets/Timeline/AudioSpikeRoot.playable`
  - `NestedL1` (PlayableDirector) → `Assets/Timeline/AudioSpikeNestedL1.playable`
  - `NestedL2` (PlayableDirector) → `Assets/Timeline/AudioSpikeNestedL2.playable`
  - `DecoyAudioSource` — Scene 直置きの AudioSource。**抽出対象に含まれてはならない**囮（Requirement 1.x の走査起点限定の検証用）
- フレームレート: 30 fps / ルート長: 21.0 s

`AudioSpikeRoot.playable`:

| トラック | クリップ | start | duration | clipIn | timeScale | loop | クリップ音量 | トラック音量 | 検証観点 |
|---|---|---|---|---|---|---|---|---|---|
| `A_Simple` | click | 0.0 | 1.0 | 0 | 1.0 | – | 1.0 | 1.0 | 基準 |
| `G_Group/A_InGroup` | tone440 | 1.0 | 2.0 | 0 | 1.0 | – | **0.5** | **0.8** | GroupTrack 配下・音量畳み込み・44.1 kHz |
| `G_Group/A_Muted` | tone880 | 1.0 | 3.0 | 0 | 1.0 | – | 1.0 | 1.0 | **ミュートトラック**（除外されること） |
| `A_Overlap` | tone880 | 1.5 | 3.0 | 0 | 1.0 | – | **0.25** | 1.0 | `A_InGroup` と**重なり**・モノラル |
| `A_Speed` | tone440 | 5.0 | 1.0 | **0.25** | **2.0** | – | 1.0 | 1.0 | **変速 + clipIn** |
| `A_Loop` | beep(0.5s) | 8.0 | 2.5 | 0 | 1.0 | **true** | 1.0 | 1.0 | **ループ 5 回折り返し** |
| `A_Composite` | beep(0.5s) | 18.0 | 3.0 | **0.125** | **1.5** | **true** | **0.75** | 1.0 | **必須複合ケース**: ループ × 変速 × clipIn（タスク 6.1） |
| `C_Nested` | `ToNestedL1` | 11.0 | 4.0 | 0 | **0.5** | – | – | – | ネスト 1 段目・ControlClip timeScale |
| `C_Nested` | `BrokenRef` | 16.0 | 2.0 | 0 | 1.0 | – | – | – | **参照切れ ControlClip**（warning スキップ） |

`AudioSpikeNestedL1.playable`（`ToNestedL1` から参照）:

| トラック | クリップ | start | duration | clipIn | timeScale | 検証観点 |
|---|---|---|---|---|---|---|
| `L1_Audio` | click | 0.0 | 1.0 | 0 | 1.0 | ネスト 1 段の時間換算 |
| `L1_Control` | `ToNestedL2` | 1.0 | 2.0 | 0 | **2.0** | ネスト 2 段目・timeScale 累積 |

`AudioSpikeNestedL2.playable`（`ToNestedL2` から参照）:

| トラック | クリップ | start | duration | clipIn | timeScale | 検証観点 |
|---|---|---|---|---|---|---|
| `L2_Audio` | tone440 | 0.0 | 1.0 | **0.5** | 1.0 | 最深ネスト + clipIn |

### 時間換算の期待値（Q-10 の照合基準）

適用する式（ネスト 1 段ごと）:

```
root_time = offset + local_time / speed

ControlClip（local start S / clipIn cin / timeScale TS）を持つ
(offset, speed) のタイムラインに対して:
  R_S     = offset + S / speed
  speed'  = speed * TS
  offset' = R_S - cin / speed'
  子の可視窓 = [R_S, R_S + duration / speed]
```

| クリップ | ルート基準 start | 実効再生速度 | 導出 |
|---|---|---|---|
| `L1_Audio` | **11.0** | **0.5** | `ToNestedL1` が root 11.0 / TS 0.5 → local 0.0 は 11.0 + 0/0.5 |
| `L2_Audio` | **13.0** | **1.0** | L1 local 1.0 → root 11.0 + 1.0/0.5 = 13.0、速度 0.5 × 2.0 = 1.0 |
| `A_Speed` | 5.0 | 2.0 | ルート直下 |
| `A_Composite` | 18.0 | 1.5 | ルート直下 |

## 検証項目 Q-1〜Q-11

各項目の「暫定決定」「確認内容」「不成立時のフォールバック」は design.md の Research Needed 節から転記し、成功基準／失敗基準を具体化した。

| ID | 暫定決定 | 成功基準 | 失敗基準（＝フォールバックへ） |
|---|---|---|---|
| **Q-1** | eval C# の `GetOutputTracks()` + ControlPlayableAsset の ExposedReference 解決で全階層 AudioTrack を列挙できる | ネスト 2 段（root → L1 → L2）・GroupTrack 配下を含め、期待した 9 クリップすべてが列挙され、`BrokenRef` は warning で subtree スキップされる | いずれかの階層が列挙されない／`sourceGameObject.Resolve(director)` が eval コンテクストで常に null → Scene 内 PlayableDirector 全列挙 + TimelineAsset 逆引きへ。それも不可なら **NO-GO** |
| **Q-2** | `TimelineClip.start/duration/clipIn/timeScale`・`AudioPlayableAsset.clip/loop` で属性一式を取得できる | 上表の設定値が API 読み取り値および Editor UI 表示と一致。クリップ長 > 音源長で loop=true のとき Editor 実再生が折り返す | 値が UI と乖離 → SerializedObject 直接読取へ。それも不可なら **NO-GO** |
| **Q-3** | クリップ音量は AudioPlayableAsset の clip properties から取得 | 公開 API または `SerializedObject("m_ClipProperties.volume")` で 0.5 / 0.25 / 0.75 を読める | どちらでも読めない → 音量既定 1.0 + 制約明記で再協議 |
| **Q-4** | トラック音量 = AudioTrack トラックプロパティ、ミュート = `TrackAsset.muted`（階層伝搬考慮） | `m_TrackProperties.volume` で 0.8 を読める。`A_Muted` がミュートと判定され、GroupTrack ミュート時に子トラックへ伝搬する | track volume が読めない → 既定 1.0 で再協議。伝搬 API が無い → 祖先手動走査を正式経路に昇格 |
| **Q-5** | `AssetDatabase.GetAssetPath` + プロジェクトルート結合で元ファイル絶対パスを解決できる | .wav/.mp3/.ogg で実ファイルの絶対パスが得られ `File.Exists` が true。サブアセット・Packages 内アセットの判定経路が確定 | 実体を持たない参照を検出できない → error 記録経路を再設計 |
| **Q-6** | 抽出 JSON は JsonUtility + `[Serializable]` DTO（double）で生成し temp → `File.Move` で atomic write できる | double 精度が保たれ配列がシリアライズされる。sessionDir へ atomic write 成功。100+ クリップで eval 実行時間・サイズが実用域 | 精度欠落／配列不可 → 手書き JSON ライタへ。atomic write 不可 → 完了マーカーファイル方式へ |
| **Q-7** | 変速再生で Unity Editor はピッチも変動する → `asetrate` + `aresample`（`pitchMode: "resample"` 既定） | クリップ速度 2.0 / 0.5・ControlClip timeScale 変速時の Editor 実再生音のピッチが速度比どおり変動する | ピッチ非変動 → `pitchMode: "preserve-pitch"`（`atempo` チェーン）を既定へ変更 |
| **Q-8** | ffmpeg は BtbN FFmpeg-Builds の恒久タグ `win64-lgpl` zip をピン止め | 具体タグ・URL・SHA-256 が確定。native AAC / pcm_s24le と必要フィルタ（amix, adelay サンプル指定, atrim, asetrate, atempo, aresample, aformat, apad, volume）が同ビルドで動作。LICENSE.txt の義務を確認 | 必要機能の不足 → `win64-gpl` へ。BtbN 不安定 → gyan.dev release ビルドへ |
| **Q-9** | Recorder 出力の MP4 / MOV(ProRes) へ `-c:v copy` + コーデックマトリクスで mux が成立する | 実 Recorder 出力で mux 成功。ストリーム長差が 7.4 の許容誤差内。mux 所要時間からタイムアウト係数を確定 | コンテナ互換問題 → 当該コンテナのみ remux オプション調整。組合せ変更は D-6 再協議 |
| **Q-10** | 時間正規化ステップ 1–2（祖先累積式）が Unity 実挙動と一致する | 上「時間換算の期待値」表の値と Editor 実再生の発音タイミングが一致。祖先可視窓クランプが実挙動と一致 | 乖離 → C# 実装（extract 内）を実測に合わせて修正（スキーマ・TS 側は不変） |
| **Q-11** | `amix=normalize=0` が Unity の加算ミックス挙動と同等である（**仮説**） | 複数音源同時再生（音量差・重なり）の Unity 基準波形とピーク値が ffmpeg 出力と同等。クリッピング挙動も一致 | 不一致 → ゲイン計算またはミックス方式を再決定して design へ反映。**design 確定の NO-GO ゲート** |

## 実測ログ

### 2026-08-23 — 検証用アセットの構築と読み戻し（タスク 1.1）

`build-fixtures.cs` → `verify-fixtures.cs` を Editor（6000.0.36f1、`-automated`、port 7800）へ eval 送信。所要時間は構築 595 ms / 読み戻し 712 ms。

読み戻し結果（`verify-fixtures.cs` の JSON より）:

- `clipCount: 9` — 上表の全クリップが列挙された（ルート直下 6 + GroupTrack 配下 2 + ネスト 2 段 2 …のうちミュート含む 9 件）
- `warnings: ["unresolved ControlClip reference, skipping subtree: root -> C_Nested/BrokenRef"]`
- `errors: []`
- `decoyAudioSourceInScene: true` — Scene 直置き AudioSource は存在するが、TimelineAsset 起点の走査には**一切現れなかった**
- `rootDurationSec: 20.999999999998998`（= 21.0）、`fps: 30`

主要な確定値:

| 観点 | 実測結果 |
|---|---|
| クリップ音量の取得経路 | **公開 API なし。`SerializedObject` の `m_ClipProperties.volume` で読み書き成立**（0.5 / 0.25 / 0.75 を往復確認） |
| トラック音量の取得経路 | **公開 API なし。`SerializedObject` の `m_TrackProperties.volume` で読み書き成立**（0.8 → 読み戻し 0.800000011920929、float 精度どおり） |
| 階層ミュート | `TrackAsset.muted` + `TrackAsset.parent` を祖先方向に走査して判定成立（`A_Muted` → `mutedBy: "A_Muted"`） |
| GroupTrack 配下の列挙 | `TimelineAsset.GetOutputTracks()` が GroupTrack 配下の AudioTrack を平坦化して返す（`G_Group/A_InGroup`, `G_Group/A_Muted`） |
| ネスト解決 | `ControlPlayableAsset.sourceGameObject.Resolve(owner)` が **eval コンテクストで成立**。owner は各階層の PlayableDirector（root → L1 → L2 と受け渡す） |
| 参照切れ ControlClip | `Resolve()` が null を返す。例外ではないため warning + subtree スキップで処理可能 |
| 元ファイル絶対パス | `AssetDatabase.GetAssetPath` → `Path.GetFullPath` で解決。全 9 クリップで `File.Exists == true` |
| 音源メタデータ | `AudioClip.length / channels / frequency` が取得可能（44100/48000、mono/stereo を正しく区別） |
| 時間換算 | `L1_Audio` → rootStart **11.0** / 実効速度 **0.5**、`L2_Audio` → rootStart **13.0** / 実効速度 **1.0**。上記期待値表と**完全一致** |

**この時点での Q 別ステータス**:

| ID | ステータス | 備考 |
|---|---|---|
| Q-1 | **成立（静的読み取り）** | 多段ネスト・GroupTrack・参照切れの全経路を確認。フォールバック不要 |
| Q-2 | **部分成立** | 属性一式の API 読み取りは成立。Editor UI 表示との突き合わせと loop の実再生挙動は未実測 |
| Q-3 | **成立（fallback 採用）** | 公開 API は無く `SerializedObject` 経路を正式採用とする |
| Q-4 | **成立（fallback 採用）** | 同上。ミュート伝搬は祖先手動走査を正式採用とする |
| Q-5 | **部分成立** | .wav で成立。.mp3 / .ogg / サブアセット / Packages 内アセットは未実測 |
| Q-6 | **未実測** | JsonUtility + atomic write + 大規模 Timeline は未着手 |
| Q-7 | **未実測** | Editor 実再生音のピッチ測定が必要 |
| Q-8 | **未実測** | ffmpeg ビルドの取得・検証が必要 |
| Q-9 | **未実測** | 実 Recorder 出力での mux が必要 |
| Q-10 | **部分成立** | 式の算出値と読み取り値は一致。Editor 実再生の発音タイミングとの照合は未実測 |
| Q-11 | **未実測** | 波形採取・比較が必要。**design 確定の NO-GO ゲート** |

## GO/NO-GO 判定

**未判定**。Q-6〜Q-9 / Q-11 が未実測、Q-2 / Q-5 / Q-10 が部分成立のため、判定条件を満たしていない。

ユーザー承認: **未取得**。

## ツール

| ファイル | 用途 |
|---|---|
| `tools/gen-audio.ps1` | 決定的な WAV フィクスチャを生成する |
| `tools/build-fixtures.cs` | Timeline / Scene のフィクスチャを構築する eval ペイロード（冪等） |
| `tools/verify-fixtures.cs` | 抽出経路と同じ走査でフィクスチャを読み戻し JSON で出力する eval ペイロード |

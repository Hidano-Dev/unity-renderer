# 音声合成 E2E チェックリスト（timeline-audio-remux）

実 Unity 6 + 実 ffmpeg + 実 Recorder 出力に対して、出荷コードそのものを走らせた記録。フェイク依存の単体・統合テスト（`tests/audio-remux/`）とは別に、**実環境でしか出ない不整合**を検出することを目的とする。

- 実施日: 2026-08-23
- Unity Editor: 6000.0.36f1 / Timeline 1.7.7 / Recorder 5.1.0 / Pipeline 0.5.0-exp.1
- ffmpeg: `ffmpeg-n8.1.2-44-g7c533d0f86-win64-lgpl-8.1`（`docs/ffmpeg.md` のピン止めビルド）
- 検証プロジェクト: `spike/unity-project/`（フィクスチャの構成は `spike/timeline-audio/README.md`）
- 判定基準: **ffmpeg 出力のクリック位置が MixPlan の計算値と一致すること**。Unity Editor 実再生音との比較は参考値に留め、合否には用いない（スパイク Q-10 でユーザー確定）

## 再現手順

```powershell
# 1. Editor を起動（バージョン固定・-automated。spike/AGENTS.md のルールに従う）
unity open "<repo>\spike\unity-project" --editor-version 6000.0.36f1 --args "-automated" --non-interactive
unity status --format json      # state: ready を待つ

# 2. 無音映像を用意（MP4 + MOV ProRes を 1 パスで収録）
unity command eval_file --project-path <proj> <tools>\audio-capture-setup.cs  --timeout 120 --format json
unity command eval_file --project-path <proj> <tools>\video-capture-start.cs  --timeout 600 --format json

# 3. 対象 Scene をアクティブにする（本番では core の録画パスがこの状態を作る）
unity command eval_file --project-path <proj> <tools>\e2e-open-scene.cs --timeout 120 --format json

# 4. 出荷フックをそのまま実行（抽出→検証→計画→取得→mux→確定）
pnpm exec bun run spike/timeline-audio/tools/e2e-run.ts `
  --project <proj> --session <sessionDir> --ffmpeg <ffmpeg.exe> `
  --mp4 <video.mp4> --mov <video.mov> --in 0 --out 21 --fps 30

# 5. 測定
pnpm exec bun run ... # ffprobe でストリーム長
powershell -File spike\timeline-audio\tools\analyze-wav.ps1 -Path <out.mov> -Ffmpeg <ffmpeg.exe> -Mode onsets -Threshold 0.02 -MinGapSec 0.05
```

`<tools>` は `spike/timeline-audio/tools`。E2E ドライバが CLI の代わりに供給するのは 2 つだけ（unity CLI を叩く `evalCSharp` と、146 MB の再取得を避けるための取得済み ffmpeg）で、抽出・検証・計画・filter graph・mux・確定はすべて出荷コードそのもの。

---

## 6.1 同期精度 E2E — **合格**

### ストリーム長差（Requirement 7.4: ≤ 0.5 映像フレーム = 16.7 ms @30fps）

| 出力 | 音声コーデック | 映像長 | 音声長 | 差 |
|---|---|---|---|---|
| `AudioSpike.mp4` | aac 48000 Hz stereo | 21.000000 s | 21.000000 s | **0.000000 s = 0.0000 フレーム** |
| `AudioSpike.mov` | pcm_s24le 48000 Hz stereo | 21.000000 s | 21.000000 s | **0.000000 s = 0.0000 フレーム** |

### クリック位置（計画値との一致）

`analyze-wav.ps1 -Mode onsets`（サンプル単位・閾値 0.02・最小間隔 50 ms）による実測。

| # | 音源 | 計画値 (s) | 実測 (s) | 誤差 | 検証観点 |
|---|---|---|---|---|---|
| 1 | click #1 | 0.00 | 0.000000 | **0** | 基準 |
| 2 | click #2 | 0.25 | 0.250000 | **0** | `adelay` サンプル指定 |
| 3 | click #3 | 0.50 | 0.500000 | **0** | 同上 |
| 4 | click #4 | 0.75 | 0.750000 | **0** | 同上 |
| 5 | `A_InGroup` tone440 | 1.00 | 1.000042 | +42 µs | GroupTrack 配下・44.1 kHz リサンプル |
| 6 | `A_Speed` | 5.00 | 5.000021 | +21 µs | 変速 2.0 + clipIn 0.25 |
| 7 | `A_Loop` | 8.00 | 8.000021 | +21 µs | ループ折り返し |
| 8 | nested L1 click #1 | 11.00 | 11.000000 | **0** | **ネスト 1 段**（ControlClip timeScale 0.5） |
| 9 | nested L1 click #2 | 11.50 | 11.499854 | −146 µs | 実効速度 0.5 でのクリック間隔 0.5 s |
| 10 | nested L1 click #3 | 12.00 | 11.999854 | −146 µs | 同上 |
| 11 | nested L1 click #4 | 12.50 | 12.499854 | −146 µs | 同上 |
| 12 | `L2_Audio` | 13.00 | 13.000021 | +21 µs | **ネスト 2 段**・速度累積 0.5 × 2.0 = 1.0・clipIn 0.5 |
| 13 | `A_Composite` | 18.00 | 18.000021 | +21 µs | **必須複合ケース**: ループ × 変速 1.5 × clipIn 0.125 |

**最大誤差 146 µs = 7 サンプル = 0.0044 映像フレーム**（許容 0.5 フレームに対して約 1/114）。

必須複合ケース（ループ × 変速 × clipIn、かつイン点がクリップ再生中に位置する構成）は `A_Composite` が該当し、誤差 +21 µs で合格。

### 抽出メタデータの照合

実ペイロード（`src/audio-remux/extract/templates/extract-audio.cs`）を実 Editor で実行した結果:

- `clipCount: 9` / `errorCount: 0` / `warningCount: 1`
- 警告は `control-clip-unresolved` / `root -> C_Nested/BrokenRef`（**参照切れ ControlClip を warning でスキップ**）
- `trackMuted: true` は `G_Group/A_Muted` のみ（**ミュートトラックの除外**）
- `rootStartSec` / `effectiveSpeed` がスパイクの期待値表と完全一致（ネスト 11.0 / 13.0、速度 0.5 / 1.0）
- Scene 直置きの `DecoyAudioSource` は**一切現れない**（走査起点が TimelineAsset に限定されている）

---

## 6.2 手動 E2E シナリオ — **合格**

### (a) MP4 + MOV(ProRes) の 2 出力一括合成

| 確認項目 | 結果 |
|---|---|
| 2 出力とも音声付きで確定 | **OK**（mp4 24,283 → 358,371 bytes / mov 1,895,329 → 7,862,911 bytes） |
| 最終成果物のファイル名が設定どおり | **OK**（`AudioSpike.mp4` / `AudioSpike.mov` のまま。置き換え方式） |
| デバッグモード時の無音版バックアップ | **OK**（`AudioSpike.noaudio.mp4` / `AudioSpike.noaudio.mov` として保持） |
| 一時ファイルの残骸 | **なし**（`*.audiotmp.*` は確定時に消える） |

### (b) 音源 1 件の意図的な欠落

`Assets/Audio/tone880_48k_mono_3s.wav` をリネームして実行。

| 確認項目 | 結果 |
|---|---|
| 失敗区分 | `category=extract`（**映像書き出し失敗とは別区分**） |
| エラー内容 | `extraction-errors (errors[0]: asset-path-unresolved: Audio source file is unavailable: Assets/Audio/tone880_48k_mono_3s.wav (clip A_Overlap/tone880_48k_mono_3s#0); errors[1]: ... (clip G_Group/A_Muted/tone880_48k_mono_3s#0))` — **欠落ファイルパスとクリップ ID を特定できる**（10.1） |
| 無音映像の保全 | **OK**（mp4 の SHA-256 が実行前後で不変） |
| 出力別成否 | `mp4 skipped` / `mov-prores skipped` |
| 部分ミックスへの進行 | **なし**（欠落を黙って除外せず全体を中止） |

### (c) オフライン時の取得失敗と手動配置での復旧

`spike/timeline-audio/tools/e2e-ffmpeg-acquire.ts` で実 `FfmpegAcquireManager` に対して実施。

| シナリオ | 確認項目 | 結果 |
|---|---|---|
| オフライン初回 | 失敗区分 | `kind: network`（**原因切り分けが成立**。5.6） |
| オフライン初回 | 案内内容 | 取得元 URL と **manual 配置先の絶対パス**を含む: `Download https://github.com/BtbN/... and place ffmpeg.exe at <tools>\manual\ffmpeg.exe.` |
| manual 配置後 | 使用されるバイナリ | `<tools>\manual\ffmpeg.exe`、`source: "manual"` |
| manual 配置後 | ネットワークアクセス | **0 回**（2 回目以降のオフライン動作が成立） |

---

## この E2E で検出した実装欠陥（すべて修正済み）

フェイク依存のテストでは緑のまま素通りしていた 5 件。いずれも**実行しないと出ない**種類のもので、E2E を回した価値がここに出た。

| # | 欠陥 | 症状 | 修正 |
|---|---|---|---|
| 1 | `AppendJsonString(...).Append("}")` | eval ペイロードが Unity でコンパイル失敗（`Operator '.' cannot be applied to operand of type 'void'`）。単体テストは注入文字列を固定するだけで実行していなかった | ローカル関数の戻り値は `void` なので文を分割 |
| 2 | ペイロードが Scene を開き直していた | `Scene file not found: 'AudioSpike'`。`RenderHandoff` に `scenePath` は無く `sceneName` が渡っていた。そもそもフックは録画済みセッションで動くので開き直しは非介入原則違反 | アクティブ Scene を読む方式へ変更し、`sceneName` は取り違え防止の照合に用途変更 |
| 3 | 一時出力パスが `<video>.audiotmp` | ffmpeg が出力コンテナを判定できず `Unable to choose an output format` で mux 全滅 | 拡張子を保持（`<video>.audiotmp.mp4`） |
| 4 | filter graph の入力インデックスが 0 始まり | `[0:a]` が映像入力を指し `Stream specifier ':a' ... matches no streams` で mux 全滅 | `MUX_AUDIO_INPUT_OFFSET = 1` を導入し、退行検知のテストを追加 |
| 5 | エラー詳細が `[object Object]` / 汎用メッセージ | 欠落した音源やクリップを特定できず 10.1 を満たさない | `detail()` が `{kind, issues}` を展開するよう修正し、ローダが抽出エラーを個別に引き継ぐよう変更 |

## 6.3 追検証（validate-impl の指摘対応後）

validate-impl の指摘を受けて音源長の ffprobe 確定と残骸報告を実装し、同じ環境で再実行した。

### 音源長の ffprobe 上書き

`phase=probe` が `phase=ffmpeg-acquire` と `phase=mux` の間で実行されることを確認。ルートフィクスチャは .wav のみのため上書きログは出ない（= ffprobe と Unity の値が一致）。差が出る音源で測ると:

| 音源 | ffprobe | Unity `AudioClip.length` | 差 |
|---|---|---|---|
| `click_48k_st_1s.wav` | 1.000000 | 1 | 0 |
| `tone440_44k_st_2s.wav` | 2.000000 | 2 | 0 |
| **`tone440_44k_st_2s.mp3`** | **2.000000** | **2.0636734962463379** | **−63.7 ms** |
| `tone880_48k_mono_3s.ogg` | 3.000000 | 3 | 0 |

非可逆音源だけが乖離し、ffprobe 側が実長を返す。この値で `sourceDurationSec` を上書きしてから計画するため、`atrim=end` のクランプが実音源に一致する。

ffprobe が無い構成（manual に `ffmpeg.exe` だけを配置）では警告を出して Unity の申告値へフォールバックし、合成自体は成立することも確認した。

```text
WARN  [audio-remux] ffprobe not found next to ffmpeg; falling back to Unity-reported source lengths
      (lossy sources may be clamped inaccurately)
```

### 置き換え残骸の報告

出力ディレクトリに前回実行の退避ファイル `.AudioSpike.mp4.4242.deadbeef.replace-backup` を置いて実行:

```text
WARN  [audio-remux] leftover from an interrupted previous run:
      ...\.AudioSpike.mp4.4242.deadbeef.replace-backup
      (not deleted; remove it manually once you have checked it)
```

- 報告のみで**削除しない**ことを確認（実行後もファイルが 10 bytes のまま残存）
- 今回の実行自身の `.audiotmp.<ext>` は残骸として報告されない
- 別出力（`other.mov`）由来の残骸はこの出力に紐付けられない

## 既知の制約・残課題

- **Unity Editor 実再生音との絶対位置差**: Recorder の音声収録では公称位置から −57〜+21 ms の再現性のあるずれが出る（スパイク Q-10）。発生源（Timeline の音声スケジューリング / Recorder の音声収録経路）は未切り分け。本チェックリストの判定は計画値基準のため影響しないが、「Editor で聞いた音」と最終成果物に体感差が出うる。切り分け手順は `spike/timeline-audio/README.md` の Q-10 節。
- **計画が空になる場合の ffmpeg 取得**: 音源長の確定に ffprobe が要るため、取得は計画より前に走る。ミュートのみの Scene は metadata 段階の前判定で止まるので取得は起きないが、**可聴クリップがイン/アウト点の外に全部落ちる**構成では取得だけ行って mux をスキップする。稀なケースとして許容している。
- **`tests/integration/editor-session.test.ts` の環境依存**: 実 Unity Editor がポート 7800 で動いていると、フェイクではなく実 Editor の PID を拾って失敗する（本 Spec の変更前から同様）。E2E 実施中はこのテストが赤くなるため、Editor 終了後に再実行して確認すること。

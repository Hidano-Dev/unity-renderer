# HANDOVER

## 現在地

`feature/scene-selection-gui` は **PR #3（https://github.com/Hidano-Dev/unity-renderer/pull/3）として push 済み・CI 全 green・MERGEABLE**。15 コミット。マージ判断は未実施（人間の承認待ち）。

次にやることは **`docs/backlog.md` の B-1 と B-2 の修正**（ユーザー指示）。どちらもこの PR のスコープ外なので、**別ブランチを切ること**。

## 今回やったこと

- 実機検証を完走（Scene 絞り込み GUI / RecorderTrack 掃除はすべて実機で通過）
- Codex レビュー計 6 件に対応（P1 ×3 / P2 ×3）
- **CI を赤にしていた ffmpeg 取得ロックの競合を修正**（2 回の診断が必要だった。1 回目は原因の取り違え）
- 検証中に見つかったブランチ外のバグを `docs/backlog.md` に B-1〜B-3 として記録

## 次にやること

### 1. B-1 — ZIP 展開がディレクトリエントリをファイルとして書く【最優先】

`src/audio-remux/ffmpeg/acquire.ts` の `extractZip()`（180 行目〜）。

```ts
212:  const target = resolve(destination, name);   // "ffmpeg-.../" → 末尾の / が落ちる
217:  await writeFile(target, data);               // ディレクトリ名の 0 byte ファイルができる
```

ZIP のディレクトリエントリ（名前が `/` で終わる、サイズ 0）を通常のファイルとして扱っている。続く `ffmpeg-.../bin/ffmpeg.exe` の展開で `mkdir(<dest>\ffmpeg-...\bin, { recursive: true })` が親をファイルとして見つけ `EEXIST` で落ちる。

**ffmpeg 未取得のマシンでは、音声を持つ Scene の書き出しが初回に必ず失敗する。** 実測ログ:

```
失敗理由: hook-failed
詳細: [audio-remux:ffmpeg-acquire] EEXIST: file already exists, mkdir
      '...\tools\ffmpeg\.staging-22092-...\ffmpeg-n8.1.2-44-g7c533d0f86-win64-lgpl-8.1'
```

修正方針: 名前が `/` で終わるエントリは `mkdir(target, { recursive: true })` して `continue`。

**回帰テストを必ず足すこと。** `tests/audio-remux/ffmpeg/acquire.test.ts` の `zipStored()` ヘルパーは**エントリ 1 件・ディレクトリエントリなし**の zip しか作れないため、この不具合を検出できていない。複数エントリ＋ディレクトリエントリを含む zip を作れるようヘルパーを拡張する。

> **検証前に必ず消すこと**: `%LOCALAPPDATA%\unity-render-core\tools\ffmpeg\manual\` に ffmpeg 8.1.1（Gyan build）を置いてある。実機検証を完走させるための迂回で、`ensureFfmpeg()` が最初に見る正規のフォールバック経路。**これがあると B-1 の症状が出ない。**

### 2. B-2 — ファイル実体を持たない AudioClip 参照が Scene ごと失敗させる

サブアセットの `AudioClip`（`.asset` 内に埋め込まれ音声ファイルの実体を持たない）を Timeline が参照していると、その Scene が失敗する。`spike/unity-project` の `AudioSpikeSources` で再現する。

```
失敗理由: hook-failed
詳細: [audio-remux:extract] metadata validation failed: validation-error
      (clips.4.sourceDurationSec: Too small: expected number to be >0)
```

関係する場所:

- `src/audio-remux/extract/templates/extract-audio.cs:216` — `audio.length` をそのまま出す。実体のないサブアセットでは 0 になる
- `src/audio-remux/metadata/schema.ts:39` — `sourceDurationSec: finiteNumber.positive()` が 0 を弾く。**スキーマ検証は ffprobe による上書きより前に走る**
- `src/audio-remux/index.ts:159-164` — ffprobe の実測値で `sourceDurationSec` を差し替える箇所（検証を通った後）

**まず設計意図を確認すること。** `spike/timeline-audio/README.md` の Q-5 は「`AssetDatabase.IsSubAsset()` が true かつ拡張子が音声形式でないことで検出できる。**これを error として記録する**」と書いている。クリップ単位の error 記録を想定していたなら、抽出側で当該クリップを除外して警告に降格する。Scene 失敗が想定どおりなら、`clips.4.sourceDurationSec` ではなく「音声ファイルの実体を持たない参照」と分かる文言にする（現状では利用者が原因を特定できない）。

### 3. 保留中の判断

- Codex のレビュー 6 件への「対応済み」返信を PR へ投稿するか（外向き操作なので未実施）
- PR #3 のマージ

## 決定事項

- **ブランチ外のバグは `docs/backlog.md` に記録し、そのブランチでは直さない**（ユーザー判断）。例外は CI を止めているもの。B-4（ロック競合）はこれに該当したのでこの PR で直し、バックログから外した
- **検証用フィクスチャは uloop（Unity CLI Loop）で作る。** `execute-dynamic-code` は `--code-file` と `using UnityEditor.Recorder;` の直書きが通り、`tl.CreateTrack<RecorderTrack>()` / `track.CreateClip<RecorderClip>()` をそのまま書ける。この repo の `unity command eval` 経路は `PipelineEval_<hash>.Execute()` に包まれるため usings 不可・完全修飾必須
- **uloop はフィクスチャ生成にだけ使い、測る前に撤去する。** パッケージを入れると `Packages/manifest.json` / `packages-lock.json` / `ProjectSettings/PackageManagerSettings.asset` / `.uloop/` が変わり、「`git status --short spike/unity-project` が差分ゼロ」という検証の中核判定と project-guard のバックアップ対象を汚す
- **`recorder-track-cleanup-failed` の実機再現は諦める。** `patchManifest()` が `com.unity.recorder` を無ければ追加し直す（`src/project-guard/manifest-patch.ts:38-45`）ため、manifest から抜いても型解決失敗にならない。エラー経路は unit test の担保に留める
- **`--port` の検証は Commander の引数パーサーと `runGui` の両方に置く。** 前者は不正値をエコーした案内、後者はプログラムから呼ばれた場合に reject ではなく exit 1 を返すための保険

## 捨てた選択肢と理由

- **`uloop launch` で Editor を起動** → Editor が `D:\UnityEditors\` にあり、uloop は Unity Hub の既定パスしか探さないため `executable not found`。`unity open` で起動すれば uloop は**起動元を問わずその Editor に接続する**
- **`uloop skills install`** → skill が `spike/unity-project/.claude/skills` に入る。clean に保ちたいディレクトリなので入れず、`--help` だけで足りた
- **RecorderClip を設定なしの空クリップにする** → 掃除が失敗しても二重書き出しが起きず、「`Recordings/` 未生成」という判定が空振りする。実物の `MovieRecorderSettings` を付けた
- **`AudioSpike` の検証で `range` を指定する** → 録画長が固定され、duration 短縮（26.0 → 21.0）が出力に現れない。`range` を省いて全長録画した
- **GUI 検証でプロジェクトパスを spike に差し替える** → 利用者の保存済み GUI 状態を壊す。復元されていた実プロジェクト（45 Scene）でそのまま検証し、終了時に元の値へ戻した
- **ロック競合を「空ロックを生存とみなす」だけで直す** → これは実在するが**支配的な競合ではなく**、CI は落ち続けた（下記「ハマりどころ」）

## ハマりどころ

- **CI のフレーク診断を 1 回間違えた。** 「作りたてのロックを横取りする」は実在したが主因ではない。主因は**残骸ロックの削除が排他されていないこと**で、2 つの取得が両方「stale なので消す」と判断し、削除と作成の順序が入れ替わると両方が保持者になる。**約 50% で失敗する**ので CI の失敗率と一致した。回収権（`.acquire.lock.takeover`）で削除だけを排他して解決
- **`EEXIST` 以外を一律に失敗としてはいけない。** Windows は削除中のファイルを開くと `EPERM` / `EBUSY` / `EACCES` を返す。競合しているだけの状況が `lock-timeout` として報告されていた
- **競合テストは 1 回では意味がない。** 50% で通るなら、壊れた実装でも CI を素通りする。`tests/audio-remux/ffmpeg/acquire.test.ts` の該当テストは 25 回繰り返す形にした。**検証には一時的なストレステスト（200 ペア）を別ファイルで作り、確認後に削除するのが有効**だった（この vitest には `--repeats` が無い）
- **`Set-Content -Encoding UTF8` は BOM を付ける**（PowerShell 5.1）。これで書いた `manifest.json` が `JSON.parse` で落ち、`Temporary package addition failed.` としか出なかった（backlog B-3）。ファイルを一時的に差し替えるときは `git checkout <ref> -- <path>` を使うこと
- **PowerShell で native exe に `2>&1` を使うと 1 行ごとに `NativeCommandError` で包まれる。** `Start-Process -RedirectStandardOutput/-RedirectStandardError` に切り替える
- **`unity open` はフォアグラウンドで戻らない。** バックグラウンド実行にして `.uloop/project-runner-pin.json` の生成でレディを判定した
- Unity を強制終了すると `Temp/UnityLockfile` が 0 byte で残るが、`checkProjectLock()` は `r+` で開けるかで判定する（`src/project-guard/lock.ts:20-40`）ので stale 扱いで通る
- **ブラウザ自動操作で `await` を挟んだ長い JS は CDP が 45 秒でタイムアウトすることがある。** ボタン無効化の観測は `click()` の直後に同期で `disabled` を読む形にしたら一発で取れた
- **このブランチの upstream が `origin/main` になっている。** `git push` を引数なしで打たないこと

## 学び

- **`unity-render` は音声のない Scene だと ffmpeg を要求しない。** `Spike` が通って `AudioSpike` が落ちた差はここ。B-1 が今まで表面化しなかった理由でもある
- **uloop の Editor 探索は Unity Hub の既定パスだけ。** 実際の場所は `unity editors -i --format json` の `location` で分かる（この環境は `D:\UnityEditors\`）
- **`TimelineAsset.duration` は RecorderTrack のクリップを含む。** 削除で縮むので `open-scene` の値を使い続けてはいけない
- 実行が 1 秒未満で終わる UI の状態遷移はポーリングでは捕まらない。**同期的に設定される状態は同期的に読む**

## 実機検証の結果（済み・再実施不要）

| 項目 | 結果 |
|---|---|
| 最小正常系（`Spike`） | exit 0 |
| RecorderTrack 掃除（`AudioSpike`） | `removed=2` / duration `26.0 → 21.0` / 出力 mp4 が `duration=21.000000`・`nb_frames=630` |
| ネスト検出 | `chain: "root > ToNestedL1 > ToNestedL2"` |
| `.playable` の不変性 | SHA-256 一致（失敗した実行でも不変） |
| 二重書き出しの阻止 | `spike/unity-project/Recordings` 未生成 |
| 複数 Scene バッチ | 進捗表示・部分失敗で exit 2 |
| GUI 絞り込み（実ブラウザ / 45 Scene） | 全項目。`Suisei_Pajama` が Scene 名 `20260623_SuiseiPajama` に一致＝パス側にも当たっている証拠 |
| GUI のライブログ・ボタン無効化 | クリック時に 4 ボタンが同期的に `disabled`、完了後に復帰 |

### フィクスチャの再生成手順（必要になったら）

```powershell
# フェーズ A: uloop で生成
uloop package install --project-path spike\unity-project
unity open "<repo>\spike\unity-project" --editor-version 6000.0.36f1 --args "-automated" --non-interactive
uloop --project-path spike\unity-project execute-dynamic-code --code-file <build-recorder-track-fixture.cs>
uloop launch -q --project-path spike\unity-project
git checkout -- spike/unity-project/Packages spike/unity-project/ProjectSettings
Remove-Item -Recurse -Force spike\unity-project\.uloop

# フェーズ B: 計測（uloop 撤去後）
dist\unity-render.exe render <config>.json
```

生成コードは `AudioSpikeRoot.playable`（clip 21.0–26.0、duration を 21.0 → 26.0 へ伸ばす）と `AudioSpikeNestedL2.playable`（clip 0.0–1.0）へ `RecorderTrack` + `RecorderClip` + `MovieRecorderSettings`（320×180、出力先 `Recordings/`）を追加し、`AssetDatabase.SaveAssets()` を最後に 1 回だけ呼ぶ。既存の `RecorderTrack` を先に消すので冪等。

## このブランチで直したもの（レビュー対応）

| 指摘 | 対応 |
|---|---|
| P1 `src/gui/runner.ts` 実行ロックの取得タイミング | `#running` を設定ファイル書き込みの `await` より後に立てていたため 2 本目がガードを素通りした。ガード直後に立て、失敗経路で解放 |
| P1 `src/gui/page.ts` 走査中の実行 | 走査中は一覧を空にして loading 状態へ移し、実行と再読み込みを禁止（`updateRunButtons()`） |
| P2 `src/gui/page.ts` 古い走査結果 | 世代番号 `sceneRequest` で最新要求以外の応答を捨てる |
| P2 `recorder-tracks.cs` 共有 Timeline | `visited` のキーに owner の instance ID を含める。owner ごとに別の子へ解決される構成で 2 つ目を循環として捨てていた |
| P1 `src/gui/page.ts` 手入力でのプロジェクト変更 | `selectionProjectPath` で選択の帰属を覚え、パスが変われば捨てる |
| P2 `src/cli/index.ts` `--port` の検証 | Commander の引数パーサー＋`runGui` の範囲確認 |

## 関連ファイル

- `docs/backlog.md` — B-1 / B-2 / B-3
- `src/audio-remux/ffmpeg/acquire.ts` — B-1 の修正対象。ロック競合の修正もここ
- `src/audio-remux/metadata/schema.ts` / `src/audio-remux/extract/templates/extract-audio.cs` / `src/audio-remux/index.ts` — B-2 の関係箇所
- `tests/audio-remux/ffmpeg/acquire.test.ts` — `zipStored()` の拡張が B-1 の回帰テストに必要

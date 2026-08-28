# HANDOVER

## 現在地

`main` は PR #3（Scene 選択 GUI / RecorderTrack 掃除）をマージ済み。

作業中のブランチは **`fix/ffmpeg-zip-and-subasset-clips`**、**PR #4（https://github.com/Hidano-Dev/unity-renderer/pull/4）として push 済み**。`docs/backlog.md` の **B-1 と B-2 を修正し、実機検証まで完了**。ユニットテスト 310 件・biome・tsc・`artgraph check --diff` もすべて green。

残りはレビューとマージ判断（人間の承認待ち）。

## 今回やったこと

### B-1 — ZIP のディレクトリエントリをファイルとして書いていた

`extractZip()`（`src/audio-remux/ffmpeg/acquire.ts`）が全エントリを `writeFile` していた。名前が `/` で終わるディレクトリエントリも同じ経路を通り、`resolve()` が末尾の区切りを落とすため `ffmpeg-.../` が `<dest>\ffmpeg-...` という 0 byte のファイルになる。続く `bin/ffmpeg.exe` の `mkdir` が親をファイルとして見つけて `EEXIST` で落ちていた。名前が区切りで終わるエントリは `mkdir(target, { recursive: true })` して次へ進むようにした。

テストの `zipStored()` は 1 エントリの zip しか作れず不具合を検出できていなかったので、複数エントリを組める `zipArchive()` を足し、配布 zip と同じ構成（ディレクトリエントリ 2 件 + `bin/ffmpeg.exe` + `bin/ffprobe.exe`）の回帰テストを追加した。修正前はこのテストが落ちることを確認済み。

### B-2 — 実体のない音源参照が別の理由で落ちていた

`requirements.md` の 2.2 が「サブアセット等ファイル実体を持たない参照は**抽出対象外として**エラー記録する」と定めており、`schema.ts` にも `sub-asset-source` の error 種別がある。**つまり Scene 失敗は設計どおり**で、バグは「error を積みながらクリップも `clips` に出していた」こと。`sourcePath` が null・`sourceDurationSec` が 0 のエントリができ、スキーマ検証が `load.ts` の errors 確認より先に落ちて `clips.4.sourceDurationSec: Too small` という無関係な文面になっていた。

`extract-audio.cs` でエラーを記録したクリップはエントリを出さずに `continue` する。あわせて `src/audio-remux/index.ts` で、抽出側が自ら報告したエラーを `metadata validation failed` ではなく `audio extraction reported errors` と伝えるようにした（JSON 不整合の文面は従来どおり）。

## 次にやること

- PR #4 のレビューとマージ判断
- `docs/backlog.md` の **B-3**（BOM 付き `manifest.json` で原因不明のエラー）。軽微
- **`%LOCALAPPDATA%\unity-render-core\tools\ffmpeg\manual\` は消してよい。** B-1 を迂回するために置いた ffmpeg 8.1.1（Gyan build）で、もう不要。管理下ビルド（8.1.2）が同じ場所の `<buildId>\` に入っており、`manual\` がある限りそちらが優先され続ける

## 決定事項

- **ブランチ外のバグは `docs/backlog.md` に記録し、そのブランチでは直さない**（ユーザー判断）。例外は CI を止めているもの。修正したものはバックログから「解決済み」表へ移す
- **検証用フィクスチャは uloop（Unity CLI Loop）で作る。** `execute-dynamic-code` は `--code-file` と `using UnityEditor.Recorder;` の直書きが通り、`tl.CreateTrack<RecorderTrack>()` / `track.CreateClip<RecorderClip>()` をそのまま書ける。この repo の `unity command eval` 経路は `PipelineEval_<hash>.Execute()` に包まれるため usings 不可・完全修飾必須
- **uloop はフィクスチャ生成にだけ使い、測る前に撤去する。** パッケージを入れると `Packages/manifest.json` / `packages-lock.json` / `ProjectSettings/PackageManagerSettings.asset` / `.uloop/` が変わり、「`git status --short spike/unity-project` が差分ゼロ」という検証の中核判定と project-guard のバックアップ対象を汚す
- **`recorder-track-cleanup-failed` の実機再現は諦める。** `patchManifest()` が `com.unity.recorder` を無ければ追加し直す（`src/project-guard/manifest-patch.ts:38-45`）ため、manifest から抜いても型解決失敗にならない。エラー経路は unit test の担保に留める
- **`--port` の検証は Commander の引数パーサーと `runGui` の両方に置く。** 前者は不正値をエコーした案内、後者はプログラムから呼ばれた場合に reject ではなく exit 1 を返すための保険
- **抽出側が error を積んだクリップは `clips` に出さない。** 出すと受け側のスキーマ検証が errors 確認より先に落ち、報告される理由が別物になる

## 捨てた選択肢と理由

- **`uloop launch` で Editor を起動** → Editor が `D:\UnityEditors\` にあり、uloop は Unity Hub の既定パスしか探さないため `executable not found`。`unity open` で起動すれば uloop は**起動元を問わずその Editor に接続する**
- **`uloop skills install`** → skill が `spike/unity-project/.claude/skills` に入る。clean に保ちたいディレクトリなので入れず、`--help` だけで足りた
- **RecorderClip を設定なしの空クリップにする** → 掃除が失敗しても二重書き出しが起きず、「`Recordings/` 未生成」という判定が空振りする。実物の `MovieRecorderSettings` を付けた
- **`AudioSpike` の検証で `range` を指定する** → 録画長が固定され、duration 短縮（26.0 → 21.0）が出力に現れない。`range` を省いて全長録画した
- **GUI 検証でプロジェクトパスを spike に差し替える** → 利用者の保存済み GUI 状態を壊す。復元されていた実プロジェクト（45 Scene）でそのまま検証し、終了時に元の値へ戻した
- **ロック競合を「空ロックを生存とみなす」だけで直す** → これは実在するが**支配的な競合ではなく**、CI は落ち続けた（下記「ハマりどころ」）
- **B-2 をクリップ単位のスキップ＋警告に降格する** → `requirements.md` 2.2 と `load.ts` が Scene 失敗を前提にしている。降格すると「音が 1 本抜けたまま成功扱い」になる

## ハマりどころ

- **CI のフレーク診断を 1 回間違えた。** 「作りたてのロックを横取りする」は実在したが主因ではない。主因は**残骸ロックの削除が排他されていないこと**で、2 つの取得が両方「stale なので消す」と判断し、削除と作成の順序が入れ替わると両方が保持者になる。**約 50% で失敗する**ので CI の失敗率と一致した。回収権（`.acquire.lock.takeover`）で削除だけを排他して解決
- **`EEXIST` 以外を一律に失敗としてはいけない。** Windows は削除中のファイルを開くと `EPERM` / `EBUSY` / `EACCES` を返す。競合しているだけの状況が `lock-timeout` として報告されていた
- **競合テストは 1 回では意味がない。** 50% で通るなら、壊れた実装でも CI を素通りする。`tests/audio-remux/ffmpeg/acquire.test.ts` の該当テストは 25 回繰り返す形にした。**検証には一時的なストレステスト（200 ペア）を別ファイルで作り、確認後に削除するのが有効**だった（この vitest には `--repeats` が無い）
- **回帰テストは「修正を戻すと落ちる」ところまで見る。** `git stash push -- <src だけ>` → 該当テスト実行 → `git stash pop` が速い。B-1 の元テストは修正前でも通ってしまう作りだったので、この確認をしないと同じ穴を掘る
- **`Set-Content -Encoding UTF8` は BOM を付ける**（PowerShell 5.1）。これで書いた `manifest.json` が `JSON.parse` で落ち、`Temporary package addition failed.` としか出なかった（backlog B-3）。ファイルを一時的に差し替えるときは `git checkout <ref> -- <path>` を使うこと
- **PowerShell で native exe に `2>&1` を使うと 1 行ごとに `NativeCommandError` で包まれる。** `Start-Process -RedirectStandardOutput/-RedirectStandardError` に切り替える
- **`unity open` はフォアグラウンドで戻らない。** バックグラウンド実行にして `.uloop/project-runner-pin.json` の生成でレディを判定した
- Unity を強制終了すると `Temp/UnityLockfile` が 0 byte で残るが、`checkProjectLock()` は `r+` で開けるかで判定する（`src/project-guard/lock.ts:20-40`）ので stale 扱いで通る
- **ブラウザ自動操作で `await` を挟んだ長い JS は CDP が 45 秒でタイムアウトすることがある。** ボタン無効化の観測は `click()` の直後に同期で `disabled` を読む形にしたら一発で取れた

## 学び

- **`unity-render` は音声のない Scene だと ffmpeg を要求しない。** `Spike` が通って `AudioSpike` が落ちた差はここ。B-1 が今まで表面化しなかった理由でもある
- **管理下 ffmpeg のパスは 2 段ネストする。** `<tools>\<buildId>\` に staging を rename し、その中に zip のルート（同じ `<buildId>` 名）が入るので、実体は `<tools>\<buildId>\<buildId>\bin\ffmpeg.exe`
- **`manual\` が残っていると管理下ビルドの経路は一切走らない。** `ensureFfmpeg()` は `manual\ffmpeg.exe` の smoke test が通った時点で返す。取得経路を実機で見たいときは必ず退避する
- **uloop の Editor 探索は Unity Hub の既定パスだけ。** 実際の場所は `unity editors -i --format json` の `location` で分かる（この環境は `D:\UnityEditors\`）
- **`TimelineAsset.duration` は RecorderTrack のクリップを含む。** 削除で縮むので `open-scene` の値を使い続けてはいけない
- 実行が 1 秒未満で終わる UI の状態遷移はポーリングでは捕まらない。**同期的に設定される状態は同期的に読む**

## 実機検証の結果（PR #4・済み）

`manual\` を退避して `tools\ffmpeg\` を空にした状態から実施。

| 項目 | 結果 |
|---|---|
| B-1: `AudioSpike` を初回取得から書き出し | exit 0（46.73s）。146 MB の取得・展開・smoke test を通過 |
| B-1: 展開後のレイアウト | `<tools>\<buildId>\<buildId>\` に `bin` / `doc` / `presets` の**ディレクトリ**と `LICENSE.txt`。0 byte ファイルは無し |
| B-1: 出力の音声 | `ffprobe`（取得したビルド）で `codec_name=aac` / `duration=21.000000` |
| B-2: `AudioSpikeSources` の失敗文面 | `[audio-remux:extract] audio extraction reported errors: extraction-errors (errors[0]: sub-asset-source: AudioClip is a sub-asset with no source file: Assets/Audio/SubAssetContainer.asset (clip S4_AudioClip_sub-asset_no_file/AudioClip sub-asset (no file)#0))`、exit 2 |
| プロジェクトの不変性 | `git status --short spike/unity-project` 差分ゼロ・`Recordings/` 未生成 |

## 実機検証の結果（PR #3 で実施済み・再実施不要）

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

## 関連ファイル

- `docs/backlog.md` — 未修正は B-3 のみ
- `src/audio-remux/ffmpeg/acquire.ts` — B-1 の修正。ロック競合の修正もここ
- `src/audio-remux/extract/templates/extract-audio.cs` / `src/audio-remux/index.ts` — B-2 の修正
- `tests/audio-remux/ffmpeg/acquire.test.ts` — `zipArchive()` が複数エントリ zip を作る

# 実 Unity E2E 手動シナリオチェックリスト

対象タスク: 10.2 実 Unity プロジェクトでの E2E 手動シナリオを実施する

実施日時: 2026-08-23 02:23–02:38 JST  
実施者: Codex  
対象: `spike/unity-project`  
Unity Editor: `6000.0.36f1`（`ProjectSettings/ProjectVersion.txt` と一致）

## 事前条件

- [x] 実行前のルート `git status --short` はクリーン。
- [x] `unity editors -i` で `6000.0.36f1` のインストールを確認。
- [x] `Unity.exe -projectPath "...\spike\unity-project" -automated` の固定版起動を試行。
- [x] UnityTestRunner はリポジトリ内に存在しないため、代替として `pnpm test` を実行した（34 files / 101 tests passed）。
- [x] `pnpm exec bun build ... --compile` 成功。
- [x] `pnpm exec tsc --noEmit` 成功。

## シナリオ A: 2 Scene バッチ（MP4 + MOV(ProRes)）

手順:

1. 2つの Scene（`Spike` と一時複製 `SpikeE2E`）を設定し、MP4 と MOV(ProRes)、320x180、30 fps、0–1秒を指定する。
2. `render` CLI を実行し、Scene ごとの成否一覧と出力ファイルのサイズを確認する。
3. 実行後に `Packages/manifest.json` と `Packages/packages-lock.json` が実行前の内容へ戻り、対象プロジェクトのGit差分がないことを確認する。

実測結果（再試行）:

- [ ] 2 Scene バッチ完走。
- [ ] MP4 出力を確認。
- [ ] MOV(ProRes) 出力を確認。
- [ ] 成否一覧を確認。
- [x] manifest/lock は `com.unity.pipeline@0.5.0-exp.1` のまま Package 解決に成功。
- [x] 固定版 Editor `6000.0.36f1` を `-automated` で起動し、Pipeline `ready`（port 7800）を確認。
- [x] `open-scene` payload の実測 eval は `success: true`（約 1.0 秒）。
- [x] `render` は 2 回実行したが、最初の録画工程から進捗・status/output が生成されず、約 120 秒超で手動停止。出力ファイル 0 件。
- [x] 実行後に一時 Scene、Library、Temp、UserSettings、生成 ProjectSettings、Package lock を撤去・復元した。

再現コマンド:

```powershell
& "D:\UnityEditors\6000.0.36f1\Editor\Unity.exe" `
  -projectPath "D:\Personal\Repositries\unity-renderer\spike\unity-project" `
  -automated
```

Editor.log の実測エラー:

```text
An error occurred while resolving packages:
Project has invalid dependencies:
  com.unity.pipeline: Package [com.unity.pipeline@0.2.0] cannot be found
```

補足: Unity CLI の実仕様に合わせ、Editor 起動引数を `unity open <project> --editor-version 6000.0.36f1 --args=-automated` に修正し、CLI JSON の `data.result` 包装を受け入れるよう修正した。これらの修正と通常テストは成功したが、録画工程の実機完走は確認できなかった。

## シナリオ B: Editor 強制終了後の次回起動復旧

手順:

1. バッチ実行中に Editor を強制終了する。
2. 次回 `render` 起動時に `active` セッション／バックアップ残骸の検出通知を確認する。
3. manifest と packages-lock の復元後、残骸が消え、対象プロジェクトのGit差分がないことを確認する。

実測結果（再試行）:

- [ ] 強制終了を伴うバッチ実行。
- [ ] 次回起動時の残骸検出・通知。
- [ ] 自動復元。
- [x] A の録画工程が完走しなかったため、B の強制終了・次回復旧は実施不可。

## 事後確認

- [x] `spike/unity-project` の恒久ファイル変更を撤去。
- [x] `git status --short` がクリーンであることを確認。
- [x] UnityTestRunner 不在のため、代替検証として `pnpm test` を実行する。

判定: **MANUAL_VERIFY_REQUIRED**。Package 解決、固定版 Editor 起動、Pipeline 疎通、payload eval、ビルド、テストは確認できたが、実機録画の status/output が生成されずシナリオ A 完走と B の復旧確認に至らなかった。

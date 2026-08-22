# 実 Unity E2E 手動シナリオチェックリスト

対象タスク: 10.2 実 Unity プロジェクトでの E2E 手動シナリオを実施する

実施日時: 2026-08-23 JST  
実施者: Codex  
対象: `spike/unity-project`  
Unity Editor: `6000.0.36f1`（`ProjectSettings/ProjectVersion.txt` と一致）

## 事前条件

- [x] 実行前のルート `git status --short` はクリーン。
- [x] `unity editors -i` で `6000.0.36f1` のインストールを確認。
- [x] `Unity.exe -projectPath "...\spike\unity-project" -automated` の固定版起動を試行。
- [ ] UnityTestRunner はリポジトリ内に存在しないため、代替として `pnpm test` を実行する。

## シナリオ A: 2 Scene バッチ（MP4 + MOV(ProRes)）

手順:

1. 2つの Scene（`Spike` と一時複製 `SpikeE2E`）を設定し、MP4 と MOV(ProRes)、320x180、30 fps、0–1秒を指定する。
2. `render` CLI を実行し、Scene ごとの成否一覧と出力ファイルのサイズを確認する。
3. 実行後に `Packages/manifest.json` と `Packages/packages-lock.json` が実行前の内容へ戻り、対象プロジェクトのGit差分がないことを確認する。

実測結果:

- [ ] 2 Scene バッチ完走。
- [ ] MP4 出力を確認。
- [ ] MOV(ProRes) 出力を確認。
- [ ] 成否一覧を確認。
- [x] 固定版 Editor 起動は実行したが、Package解決前に終了した。
- [x] 終了理由: `com.unity.pipeline@0.2.0` が見つからず、Pipeline server（7800）へ到達できなかった。
- [x] 一時 Scene、Library、Temp、Package lock の変更を撤去・復元した。

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

なお、CLIの `pnpm build` も `bun` が環境にないため実行不能だった。`bun build ...` が要求される現状では、CLI経由の実機バッチを成立させられない。

## シナリオ B: Editor 強制終了後の次回起動復旧

手順:

1. バッチ実行中に Editor を強制終了する。
2. 次回 `render` 起動時に `active` セッション／バックアップ残骸の検出通知を確認する。
3. manifest と packages-lock の復元後、残骸が消え、対象プロジェクトのGit差分がないことを確認する。

実測結果:

- [ ] 強制終了を伴うバッチ実行。
- [ ] 次回起動時の残骸検出・通知。
- [ ] 自動復元。
- [x] CLIバッチがPackage解決前に開始できなかったため、実機シナリオは未実施。

## 事後確認

- [x] `spike/unity-project` の恒久ファイル変更を撤去。
- [x] `git status --short` がクリーンであることを確認。
- [x] UnityTestRunner 不在のため、代替検証として `pnpm test` を実行する。

判定: **MANUAL_VERIFY_REQUIRED**。Unity 6.0.36f1 に対応する `com.unity.pipeline`（スパイクで成立確認済みの `0.5.0-exp.1`）を解決可能にし、`bun` を導入した環境でシナリオA/Bを再実施する必要がある。

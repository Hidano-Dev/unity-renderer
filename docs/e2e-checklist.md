# Unity E2E 手動シナリオチェックリスト

対象タスク: 10.2 実 Unity プロジェクトでの E2E 手動シナリオを実施する

実施日時: 2026-08-23 16:20–16:24 JST
実施者: Codex
対象プロジェクト: `.tmp-e2e-run-102` / `.tmp-e2e-run-102-b`（`spike/unity-project` の使い捨てコピー）
Unity Editor: `6000.0.36f1`（`ProjectVersion.txt` と一致）
パッケージ: `com.unity.pipeline@0.5.0-exp.1`、`com.unity.recorder@5.1.0`

## 事前条件

- [x] 対象プロジェクトはコミット済みの `spike/unity-project` から作成し、リポジトリ本体を変更しないことを確認した。
- [x] `Spike` と `SpikeE2E` の Unity 作成済みシーンを確認した。
- [x] `unity open` の Editor version を `6000.0.36f1` に固定し、`--args=-automated` を使用した。
- [x] `debug: true` の JSON を BOM なしで作成した（先頭バイト `123,10,32`）。
- [x] 実行前後に Editor プロセスと Unity ロックの残留がないことを確認した。

設定: 2 シーン、MP4 + MOV(ProRes)、320x180、30 fps、範囲 0–1 秒。

## シナリオ A: 2 Scene バッチ（MP4 + MOV(ProRes)）

実行コマンド:

```powershell
pnpm exec bun run src/cli/index.ts render .tmp-e2e-run-102/render-config.json
```

測定結果:

- [x] `Spike` が成功し、`Spike_3.mp4`（5,861 bytes）と `Spike_3.mov`（749,497 bytes）を生成した。
- [x] `SpikeE2E` が成功し、`SpikeE2E_2.mp4`（5,861 bytes）と `SpikeE2E_2.mov`（749,497 bytes）を生成した。
- [x] バッチ結果で 2 Scene とも成功を確認した。
- [x] 各 Scene の Editor 終了後、次の Scene の Editor 起動・録画・終了が完了した。
- [x] 起動直後の HTTP 503 Server Busy と Play Mode 切替直後の一時的な通信エラーは自動再試行で回復した。
- [x] `quit-editor` の `Invalid response format` は Editor 終了により応答前に接続が切れる既知の期待動作であり、Scene は成功扱いになった。

判定: **PASS**

## シナリオ B: Editor 強制終了後の次回復旧

手順:

1. 独立コピー `.tmp-e2e-run-102-b` で同じ `render` を起動した。
2. `Spike` 処理中に Unity Editor プロセスを `Stop-Process -Force` で強制終了した。
3. `session.json` が `status: "active"` のまま残ることを確認した。
4. CLI を停止して stale active 状態を保持し、次の `render` を同じ設定で起動した。

測定結果:

- [x] 強制終了後に `session.json` の active セッションを確認した。
- [x] 次回 `render` が stale active セッションを検出して復旧処理を行い、通常のバッチへ復帰した。
- [x] 復旧後に `Spike_1.mp4`（5,861 bytes）、`Spike_1.mov`（749,497 bytes）、`SpikeE2E_1.mp4`（5,861 bytes）、`SpikeE2E_1.mov`（749,497 bytes）を生成した。
- [x] 復旧後は 2 Scene とも成功し、`session.json` と Unity ロックが残らないことを確認した。
- [x] `manifest.json` / `packages-lock.json` は復旧後も保持され、Unity Editor が生成した値を上書きしなかった。

判定: **PASS**

## 事後確認

- [x] `pnpm test` を実行する（UnityTestRunner はリポジトリに存在しないため代替検証）。
- [x] 実行対象の一時ディレクトリは `.tmp-e2e-run*` としてコミット対象外にする。

総合判定: **PASS**

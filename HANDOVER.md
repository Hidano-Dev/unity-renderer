# HANDOVER

## 今回やったこと

- 前回の HANDOVER を読み、**実機検証の手順を提示**（前提チェック → 最小正常系 → 音声あり → 複数 Scene → 異常系 → 後始末確認）。**検証自体は未実施**
- ユーザーからの追加要件 2 件を `feature/scene-selection-gui` 上に実装。**push 未実施・PR 未作成**
  - `e8ec753` **GUI の Scene 部分一致フィルタ** — 大量の `SampleScene` から対象を選び出せるようにする
  - `c6f804c` **録画前の RecorderTrack 削除と復元** — Timeline 上の RecorderTrack による二重書き出しを防ぐ
- 検証済み: `vitest` **297 件 pass**（新規 30 件）、`biome check` ✓ / `tsc --noEmit` ✓ / `artgraph check --diff` ✓、`pnpm build` で exe 再生成済み
- 前セッションから残っていた GUI サーバー（PID 37064）を、ユーザー承認のうえ終了（exe を掴んでビルドが EPERM になっていた）

## 決定事項

### GUI フィルタ

- 一致判定は **Scene 名 + アセットパス**への部分一致（大文字小文字無視、単一文字列）
- 一致しない行は **DOM から消さず `hidden` で隠す**。`checkedSceneNames()` がチェックボックスを直接読むため、消すと絞り込んだ瞬間に隠れた Scene の選択が保存内容から抜ける
- 「すべて ON / OFF」は**表示中の Scene にだけ**適用。絞り込み中はボタン表記を「表示中をすべて ON / OFF」へ変える
- 絞り込み文字列は `gui-state.json` へ保存（`sceneFilter`）。表示の状態だが、毎回打ち直す手間を避ける

### RecorderTrack 削除

- **削除方式はメモリ上のみ**（`DeleteTrack`）。保存 API は呼ばず、`quit-editor.cs` も保存せず終了するため `.playable` は書き換わらない
- **保険として削除前に `.playable` を project-guard セッションへ登録**（`registerBackupFiles`）。Editor が万一保存した場合・実行が落ちた場合も、manifest と同じ復元経路（次回実行時の自動復旧を含む）で戻る
- `BackupFile.skipIfUnchanged` を追加。内容が同じなら復元をスキップする（書き戻すと mtime が動き Unity が再インポートする）
- **走査は root + ControlTrack でネストした子 Timeline を再帰的に**。GroupTrack 配下も `GetChildTracks()` で明示的に辿る（深さ 32 制限 + 循環ガード）
- `RecorderTrack` 型を解決できない場合は **0 件扱いにせず Scene を失敗させる**（`recorder-track-cleanup-failed`）。二重書き出しを黙って通さないため
- 実行位置は `open-scene` の直後・`setup-recorder` の前
- 削除後の Timeline 長を再取得して録画範囲へ反映（RecorderTrack のクリップが末尾を伸ばしていた場合に縮むため）
- payload は **1 テンプレート + `mode` パラメータ**（`scan` / `remove`）。scan で 0 件なら remove もバックアップも走らせない

## 捨てた選択肢と理由

- **削除して `AssetDatabase.SaveAssets` → 終了後にファイル復元** → 正常系でも利用者の `.playable` を書き換えるため、復元失敗時の被害が大きい。メモリ上のみ + バックアップを選択（ユーザー判断）
- **root Timeline のみを対象** → ControlTrack 配下の RecorderTrack が残り、二重書き出しが起きる。再帰を選択（ユーザー判断）
- **spec を切ってから実装** → GUI 自体も spec なしで実装した実績があるため、このブランチで直接実装（ユーザー判断）
- **`scan` と `remove` で別テンプレート** → 走査ロジックが丸ごと重複する。`mode` パラメータ 1 本に統合
- **フィルタを DOM ノードの削除で実装** → 隠れた Scene の選択が失われる（上記「決定事項」参照）
- **フィルタをスペース区切りの AND 検索に** → 「部分一致」という要件より複雑で、挙動の説明が要る。単一部分一致に留めた
- **`registerBackupFiles` を毎回上書き登録** → Scene をまたいで同じ Timeline を共有していると「変更後」で上書きしてしまう。登録済みパスは読み飛ばす

## ハマりどころ

- **既存テストの `pipeline.eval` スタブが `open-scene` 以外に `"{}"` を返す**ため、新しい `recorder-tracks` eval で 12 件が一斉に落ちた。`payloadReturnValue(id, openResult)` ヘルパーを入れて解決。`tests/audio-remux/integration/core-reporting.test.ts` も同じ対処が必要だった
- `runner.ts` で **`session` が二重定義**になった（`BackupSession` を保持する外側の変数と、ループ内の `EditorSession`）。ループ内を `editorSession` へ改名
- `pnpm build` が **EPERM で exe を置き換えられない**。前セッションの GUI サーバーが生きたままだった。`Get-Process unity-render` で特定
- `restoreBackupSession` は `session.files` を汎用に回すので、**エントリを足すだけでクラッシュ復旧まで通る**。ただし runner の `finally` が `plan.session` を見ていたので、更新後の `session` を見るよう変更が必要だった
- `tests/audio-remux/ffmpeg/acquire.test.ts` のフレークは今回も 1 度だけ再現。再実行で pass（前回と同じ、今回の変更とは無関係）
- biome の format 差分は書いた直後に必ず出る。`npx biome format --write .` を挟むこと

## 学び

- **現行の録画は RecorderTrack を一切使っていない**。Play Mode 内で `RecorderController` を組む方式（`start-recording.cs`）。Timeline 上の RecorderTrack は利用者が置いたものだけで、放置すると管理外パスへ二重書き出しになる
- `quit-editor.cs` は `AssetDatabase` / Scene の保存 API を呼ばず `EditorApplication.Exit(0)` する。**この設計のおかげでメモリ上の Timeline 変更がディスクに残らない** — 逆に言うと、ここに保存呼び出しを足すと今回の前提が崩れる
- `TimelineAsset.duration` は RecorderTrack のクリップを含んだ値。削除で縮み得るので、`open-scene` の値をそのまま使い続けてはいけない
- eval payload から Recorder の型を **`AppDomain.CurrentDomain.GetAssemblies()` + `GetType(名前)` で解決**すると、パッケージ未導入の環境でもコンパイルが通る。ただし「見つからない＝0 件」にすると危険なので、明示的にエラーを返すこと

## 次にやること

1. **【最優先】実機検証** — 前回から積み残し。今回の変更で確認項目が増えている
   ```powershell
   cd D:\Personal\Repositries\unity-renderer
   .\unity-render-gui.bat
   ```
   - 既存分: 進捗ログのライブ表示 / 実行中のボタン無効化 / exit 3 の日本語メッセージ / 複数 Scene バッチ表示
   - **新規（フィルタ）**: 絞り込み中に「表示中をすべて ON」が表示中だけに効くか / 隠れた Scene の選択が保存に残るか / 再起動で絞り込み文字列が復元されるか
   - **新規（RecorderTrack）**: RecorderTrack を持つ Scene を `spike/unity-project` に用意し、削除ログが警告として出るか / 書き出し後に `git status --short spike/unity-project` が**差分ゼロ**か（`.playable` が保存されていない証明）/ ネストした子 Timeline の RecorderTrack も外れるか
2. 実機検証が通ったら **push と PR 作成**（`git push -u origin feature/scene-selection-gui` → `gh pr create`）
3. 余力があれば: `render` 実行中の中断（キャンセル）ボタン、`range`（切り出し）の GUI 対応、`debug` チェックボックス

## 関連ファイル

新規:

- `src/csharp-payloads/templates/recorder-tracks.cs` — RecorderTrack の走査と削除（`mode` で scan / remove）
- `src/batch/recorder-tracks.ts` — 応答のパースと「scan → backup → remove」の手順
- `tests/batch/recorder-tracks.test.ts` / `tests/csharp-payloads/recorder-tracks.test.ts` / `tests/gui/page.test.ts`

変更:

- `src/gui/page.ts` — 絞り込み UI、`applySceneFilter()`、`visibleSceneBoxes()`
- `src/gui/state.ts` — `sceneFilter` の追加とサニタイズ
- `src/batch/scene-job.ts` — RecorderTrack 掃除の呼び出し、`recorder-track-cleanup-failed`、削除後 duration の反映
- `src/batch/runner.ts` — `registerBackups` の受け渡し、更新後セッションでの復元
- `src/project-guard/backup.ts` — `registerBackupFiles`、`skipIfUnchanged`
- `src/csharp-payloads/compile.ts` — `recorder-tracks` の登録
- `docs/setup.md` — 絞り込みの説明、「Timeline 上の RecorderTrack について」節

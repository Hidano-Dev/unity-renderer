# unity-render-core 初回セットアップ

この手順は Windows 上で `unity-render-core` を初めて実行するためのものです。
対象プロジェクトは Unity 6.0 以上である必要があります。CLI は `ProjectSettings/ProjectVersion.txt` の `m_EditorVersion` を読み取り、同じバージョンの Editor がインストールされていることを確認します。

## 前提条件

- Windows
- Unity Hub または Unity Editor をインストールできる権限
- 対象プロジェクトとその `ProjectSettings/ProjectVersion.txt`
- `unity-render-core` の実行ファイル、またはこのリポジトリを実行できる Bun 環境
- ブラウザーを開ける Unity アカウント

## 1. Unity CLI をインストールして PATH を確認する

Unity の公式 Unity CLI を、使用する組織の承認済みの公式配布手順からインストールしてください。Unity Editor の `Unity.exe` を `unity` CLI の代わりに PATH へ登録しないでください。インストール後は新しい PowerShell を開き、次を実行します。

```powershell
where.exe unity
unity --version
```

`unity` が見つからない場合は、CLI のインストール先が PATH に含まれているかを確認してから PowerShell を再起動します。`unity-render-core` は公式 CLI を検出できない場合、次のようなエラーを表示します。

> Unity CLI (unity) が見つかりません。Unity CLI をセットアップし、`unity auth login` を実行してください。

## 2. Unity アカウントで認証する

初回のみ、対話端末でログインします。コマンドを実行するとブラウザーで認証画面が開きます。

```powershell
unity auth login
unity auth status
```

`unity auth status` でログイン済みであることを確認してください。CI などブラウザーを開けない環境では、対話ログインを自動化せず、実行環境で事前に認証済みのアカウントまたは組織の認証方式を用意してください。認証情報をリポジトリや設定 JSON に保存しないでください。

## 3. 対象プロジェクトの Unity バージョンを確認する

プロジェクトの要求バージョンを確認します。

```powershell
Select-String -Path .\ProjectSettings\ProjectVersion.txt -Pattern '^m_EditorVersion:'
unity editors -i
```

`unity editors -i` の一覧に `ProjectVersion.txt` の `m_EditorVersion` と完全一致する Editor が必要です。Unity 6.0 未満のプロジェクトはサポート対象外です。

一致する Editor がない場合は、バージョンを明示してインストールします。

```powershell
unity install <m_EditorVersion>
unity editors -i
```

インストール先やモジュールを変更する必要がある場合は、組織の Unity Hub／Unity CLI の運用ポリシーに従ってください。`unity install` が失敗した場合、または中断を選択した場合、`unity-render-core` はプロジェクトを変更せずに終了します。

## 4. CLI の動作確認

まず、Editor を起動しない `check` を実行します。設定ファイルは `init` で作成できます。

```powershell
unity-render.exe init render-config.json
unity-render.exe check render-config.json
```

ソースから実行する場合は、リポジトリの標準コマンドを使用します。

```powershell
pnpm install
bun run src/cli/index.ts init render-config.json
bun run src/cli/index.ts check render-config.json
```

`check` は設定、Unity CLI、Editor のバージョン、Scene の存在などを確認します。`check` では Editor を起動しません。エラーが出た場合は、表示された `unity` CLI のセットアップ手順、`ProjectVersion.txt`、`unity editors -i` の結果を確認してから再実行してください。

## 4-b. コマンドを使わない場合（GUI）

コマンド操作が不要な利用者向けに、Scene をチェックボックスで選ぶ画面を用意しています。`unity-render-gui.bat` を **ダブルクリック** すると、ローカルサーバーが起動して既定のブラウザーに設定画面が開きます（`unity-render.exe gui` と同じです）。

`unity-render-gui.bat` は `unity-render.exe` と同じフォルダーに置いてください（リポジトリから使う場合は `dist\unity-render.exe` も探します）。

画面でできることは次のとおりです。

1. **Unity プロジェクト** — 「参照…」でフォルダーを選ぶと、`Assets` 配下の `.unity` をすべて一覧します
2. **書き出す Scene** — チェックボックスで選択。「絞り込み」に文字を入れると、Scene 名かフォルダ名にその文字を含むものだけが残ります。「すべて ON」「すべて OFF」は**表示中の Scene にだけ**効くので、`SampleScene` が大量にあるプロジェクトでも、書き出したいものだけを絞ってから一括で切り替えられます。絞り込みは表示を変えるだけで、隠れている Scene の選択はそのまま残ります
3. **出力設定** — 出力先フォルダー、ファイル名、解像度、フレームレート、形式
4. **実行** — 「事前チェック」は `check` と、「書き出し実行」は `render` と同じ処理で、進捗とログがそのまま画面に流れます

入力内容は変更のたびに自動保存され、次回起動時に復元されます。保存先は次のファイルです。

```text
%LOCALAPPDATA%\unity-render-core\gui-state.json
```

「事前チェック」「書き出し実行」を押すと、その時点の入力から `render-config.json` を組み立てて実行します。CLI と同じ設定スキーマで検証するため、GUI で通った設定はそのまま `unity-render.exe render render-config.json` でも実行できます。

補足事項:

- **同名の Scene は選択できません。** 設定ファイルは Scene 名で対象を指定する仕様のため、`Assets` 内に同じ名前の `.unity` が複数あると一意に決まりません。該当する行は選択不可として理由を表示するので、どちらかの名前を変更してください
- サーバーはループバック（`127.0.0.1`）にのみ待ち受け、起動ごとに発行するトークンを持つ URL でしか操作できません。ブラウザーを閉じても処理は続きます。終了するときは、`.bat` のコンソール画面で Ctrl+C を押してください
- 実行は常に 1 本だけです（Unity Pipeline のポート 7800 が固定のため）

## 5. 初回の書き出し

`check` が成功したら、次のコマンドで書き出しを実行します。

```powershell
unity-render.exe render render-config.json
```

書き出し時は `unity open` により Editor を GUI モードで起動し、`com.unity.pipeline` の localhost:7800 API と `unity command eval` を使用します。対象プロジェクトを別の Unity Editor で開いたままにせず、実行前に保存してください。CLI は通常処理の終了時に Editor を閉じ、パッケージ設定を復元します。

### Timeline 上の RecorderTrack について

このツールの録画は、Play Mode 内で Recorder API（`RecorderController`）を組み立てて行います。Timeline に置かれた **RecorderTrack はそれと並行して走り、設定ファイルの管理外のパスへ二重に書き出してしまう**ため、Scene を開いた直後、録画設定を組む前にすべて取り除いてから録画します。

- 対象は root の Timeline に加え、**ControlTrack でネストした子 Timeline も再帰的に**辿ります
- 削除は Unity のメモリ上だけで行い、`.playable` ファイルは保存しません。Editor は保存せずに終了するため、**書き出し後の Timeline は元のまま**です
- 念のため、削除前に対象の `.playable` をセッションディレクトリへバックアップします。万一 Editor 側がアセットを保存してしまった場合や、実行が途中で落ちた場合は、`Packages/manifest.json` と同じ復元経路（次回実行時の自動復旧を含む）で書き戻します
- 取り除いた RecorderTrack は、Scene ごとの警告としてログに出ます
- `com.unity.recorder` の API 変更などで RecorderTrack の型を解決できない場合、「見つからなかった＝0 件」とは扱わず、その Scene を失敗させます（`recorder-track-cleanup-failed`）。二重書き出しを黙って通さないための挙動です

RecorderTrack のクリップが Timeline の末尾を伸ばしていた場合、削除で全長が短くなります。録画範囲は削除後の長さを基準に決まります。

## 注意事項: Unity CLI と Pipeline package は experimental

このツールが使用する Unity CLI の Editor 接続機能および `com.unity.pipeline` は experimental です。Unity や package の更新で、コマンド、HTTP API、Editor の起動・接続、eval の挙動が破壊的に変更される可能性があります。特に、以下を守ってください。

- Unity CLI と Editor のバージョンを無断で更新しない
- 本番の書き出し前に、対象環境のコピーまたは検証用 Scene で `check` と短い `render` を実行する
- `localhost:7800` に接続できない場合や package 解決に失敗した場合は、Editor を無理に操作せずログを保存する
- CLI 実行後に `Packages/manifest.json`、`Packages/packages-lock.json`、対象プロジェクトの Git 差分を確認する
- Unity CLI、Editor、`com.unity.pipeline` の組み合わせを更新した場合は、検証スパイクと E2E シナリオを再確認する

experimental 機能の仕様変更によって書き出しが成立しなくなった場合、既存の CLI 動作を推測で修正せず、変更内容と代替手段を記録してから再検証してください。

## 既知の制約: 同時実行は想定していない

このツールは「1 台のマシンで 1 つの `render` を実行する」前提で設計されています。Unity Pipeline のポート 7800 が固定であるため、複数の Editor を同時に制御することはできません。

同時実行に対する防御は次の 3 つで、いずれも通常の誤操作（二重起動など）を弾くには十分です。

- 起動前のポート 7800 占有チェック（使用中なら `port-conflict` で即時終了）
- 対象プロジェクトの Unity ロック（`Temp/UnityLockfile`）の確認
- 同一プロジェクトに対する active セッションの検出（前回実行が未復元なら拒否）

ただしこれらは「まったく同時に 2 つのプロセスが検査を通過する」ようなミリ秒単位の競合までは防ぎません。CI などで複数のレンダリングジョブを走らせる場合は、**ジョブスケジューラ側で直列化してください**（同一マシン上で並列に実行しない）。

## トラブルシューティング

| 症状 | 確認事項 |
|---|---|
| `unity` が見つからない | CLI のインストール、`where.exe unity`、PATH、新しい PowerShell の起動 |
| 認証に失敗する | `unity auth status`、ブラウザーのログイン状態、アカウントの権限 |
| Editor が見つからない | `ProjectVersion.txt` の値と `unity editors -i` の一覧の完全一致 |
| package 解決に失敗する | Unity CLI／Editor の対応バージョン、`com.unity.pipeline` の利用可能な版、Editor.log |
| localhost:7800 に接続できない | Editor が GUI モードで起動しているか、別 Editor のプロジェクトロックやポート競合がないか |
| CI でインストール確認が止まる | 非対話環境では自動承認されないため、必要な Editor を事前にインストールする |

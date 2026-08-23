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

## 5. 初回の書き出し

`check` が成功したら、次のコマンドで書き出しを実行します。

```powershell
unity-render.exe render render-config.json
```

書き出し時は `unity open` により Editor を GUI モードで起動し、`com.unity.pipeline` の localhost:7800 API と `unity command eval` を使用します。対象プロジェクトを別の Unity Editor で開いたままにせず、実行前に保存してください。CLI は通常処理の終了時に Editor を閉じ、パッケージ設定を復元します。

## 注意事項: Unity CLI と Pipeline package は experimental

このツールが使用する Unity CLI の Editor 接続機能および `com.unity.pipeline` は experimental です。Unity や package の更新で、コマンド、HTTP API、Editor の起動・接続、eval の挙動が破壊的に変更される可能性があります。特に、以下を守ってください。

- Unity CLI と Editor のバージョンを無断で更新しない
- 本番の書き出し前に、対象環境のコピーまたは検証用 Scene で `check` と短い `render` を実行する
- `localhost:7800` に接続できない場合や package 解決に失敗した場合は、Editor を無理に操作せずログを保存する
- CLI 実行後に `Packages/manifest.json`、`Packages/packages-lock.json`、対象プロジェクトの Git 差分を確認する
- Unity CLI、Editor、`com.unity.pipeline` の組み合わせを更新した場合は、検証スパイクと E2E シナリオを再確認する

experimental 機能の仕様変更によって書き出しが成立しなくなった場合、既存の CLI 動作を推測で修正せず、変更内容と代替手段を記録してから再検証してください。

## 既知の制約: 同時実行の排他

同一プロジェクトに対する `render` の同時実行は、セッション開始ロック（アトミックな排他作成）と active セッション検査の二段で拒否されます。加えて、クラッシュが残したロック残骸は「所有プロセス死亡かつ 30 秒以上経過」の場合にのみ、削除直前の再確認を経て回収されます。

ただし、ファイルシステム API では残骸の確認と削除を単一の原子操作にできないため、「30 秒以上前の残骸が存在する状態での二重起動 + サブミリ秒の交錯」という極端な条件下に理論的な競合窓が残ります。通常運用（1 プロジェクト 1 実行）で問題になることはありませんが、多数のジョブが同一プロジェクトへ同時に殺到し得る環境で厳密な排他保証が必要な場合は、ジョブスケジューラ側での直列化、または OS アドバイザリロック／専用ロックライブラリの導入を検討してください。

クラッシュ直後 30 秒以内の再実行は「終了処理中の可能性」としてロック検出のメッセージ付きで拒否されます。少し待ってから再実行してください。

## トラブルシューティング

| 症状 | 確認事項 |
|---|---|
| `unity` が見つからない | CLI のインストール、`where.exe unity`、PATH、新しい PowerShell の起動 |
| 認証に失敗する | `unity auth status`、ブラウザーのログイン状態、アカウントの権限 |
| Editor が見つからない | `ProjectVersion.txt` の値と `unity editors -i` の一覧の完全一致 |
| package 解決に失敗する | Unity CLI／Editor の対応バージョン、`com.unity.pipeline` の利用可能な版、Editor.log |
| localhost:7800 に接続できない | Editor が GUI モードで起動しているか、別 Editor のプロジェクトロックやポート競合がないか |
| CI でインストール確認が止まる | 非対話環境では自動承認されないため、必要な Editor を事前にインストールする |

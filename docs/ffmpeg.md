# ffmpeg のライセンスと手動配置

## 取得とライセンス

このツールは ffmpeg を配布物に同梱しません。音声合成で ffmpeg が必要になった初回実行時に、ユーザーの環境へ BtbN FFmpeg-Builds からダウンロードし、ツール管理ディレクトリに保存します。ツールが ffmpeg バイナリを再配布することはありません。

現在採用している取得対象は、Q-8 の実測で確認した次のビルドです。

| 項目 | 値 |
| --- | --- |
| ビルド | `ffmpeg-n8.1.2-44-g7c533d0f86-win64-lgpl-8.1` |
| リリースタグ | `autobuild-2026-08-22-12-58` |
| ダウンロード URL | <https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-08-22-12-58/ffmpeg-n8.1.2-44-g7c533d0f86-win64-lgpl-8.1.zip> |
| SHA-256 | `aa5ff0d7bfc091f9a43d43f7af4a2174294edacf5cdc5fff031819a5eaa763c7` |
| サイズ | `146078688` bytes |
| ライセンス | LGPL v3 |
| ソースコード | <https://github.com/BtbN/FFmpeg-Builds> |

このビルドは `--enable-version3` で構成され、`--enable-gpl` と `--enable-nonfree` は付いていません。配布 ZIP には LGPL v3 の本文を含む `LICENSE.txt` が同梱されています。ダウンロードした ZIP と `LICENSE.txt` は、ライセンス確認のために保持してください。

BtbN の `latest` タグはローリングタグで、タグ自体を指したままアセットが置き換えられます。そのため再現性のために、アセットが固定された日付付きの恒久タグ `autobuild-2026-08-22-12-58` を使用しています。

## 自動取得後の確認

自動取得が成功すると、次の managed ディレクトリにバイナリ、`LICENSE.txt`、`install-info.json` が保存されます。

```text
%LOCALAPPDATA%\unity-render-core\tools\ffmpeg\ffmpeg-n8.1.2-44-g7c533d0f86-win64-lgpl-8.1\
```

`install-info.json` を開き、少なくとも次の値が上表および `src/audio-remux/ffmpeg/manifest.ts` と一致することを確認します。

```json
{
  "buildId": "ffmpeg-n8.1.2-44-g7c533d0f86-win64-lgpl-8.1",
  "tag": "autobuild-2026-08-22-12-58",
  "url": "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-08-22-12-58/ffmpeg-n8.1.2-44-g7c533d0f86-win64-lgpl-8.1.zip",
  "sha256": "aa5ff0d7bfc091f9a43d43f7af4a2174294edacf5cdc5fff031819a5eaa763c7",
  "license": "LGPL-3.0-or-later"
}
```

## オフライン・配布元障害時の手動配置

自動取得に失敗した場合は、ネットワークに接続できる別の環境で固定 URL の ZIP を取得し、SHA-256 とサイズを確認してから対象端末へ安全に移します。PowerShell では次のように確認できます。

```powershell
$archive = "ffmpeg-n8.1.2-44-g7c533d0f86-win64-lgpl-8.1.zip"
Get-Item $archive | Select-Object Length
Get-FileHash $archive -Algorithm SHA256
```

`Length` が `146078688`、`Hash` が次の値であることを確認します。

```text
aa5ff0d7bfc091f9a43d43f7af4a2174294edacf5cdc5fff031819a5eaa763c7
```

1. ZIP を展開します。
2. 展開先の `ffmpeg-n8.1.2-44-g7c533d0f86-win64-lgpl-8.1\bin\ffmpeg.exe` を、次の manual ディレクトリへコピーします。

   ```text
   %LOCALAPPDATA%\unity-render-core\tools\ffmpeg\manual\ffmpeg.exe
   ```

   `%LOCALAPPDATA%` を展開した絶対パスは通常 `C:\Users\<ユーザー名>\AppData\Local\unity-render-core\tools\ffmpeg\manual\ffmpeg.exe` です。`manual` ディレクトリがなければ作成してください。

3. コピー後、実行確認を行います。

   ```powershell
   $manual = Join-Path $env:LOCALAPPDATA "unity-render-core\tools\ffmpeg\manual\ffmpeg.exe"
   & $manual -version
   ```

音声合成を再実行すると、ツールはこの manual 配置を managed build より先に検査し、`ffmpeg.exe -version` が成功した場合に使用します。manual 配置はユーザーが明示的に行う復旧経路のため、ZIP に同梱された `LICENSE.txt` も保持してください。manual 配置のバイナリについては `install-info.json` は自動生成されないため、上記の ZIP のサイズ・SHA-256 と `-version` の結果を確認記録として利用します。

既に managed build を取得済みなら、配布元が一時的に停止していても再ダウンロードは不要です。managed ディレクトリと `install-info.json` を削除せず、そのままオフラインで再実行してください。未取得の初回実行でオフラインまたは配布元障害になった場合は、上記の manual 配置で復旧できます。

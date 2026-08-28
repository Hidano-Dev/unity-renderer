# バックログ

着手前の未修正事項。実機検証やレビューで見つかったが、その場のブランチのスコープ外だったものを記録する。

## B-1. ZIP 展開がディレクトリエントリをファイルとして書き、ffmpeg 取得が必ず失敗する

**影響**: ffmpeg 未取得のマシンでは、**音声を持つ Scene の書き出しが必ず `hook-failed` で落ちる**。`unity-render-core` の実運用を止める重大度。

**発生箇所**: `src/audio-remux/ffmpeg/acquire.ts:201-206`

```ts
const target = resolve(destination, name);   // "ffmpeg-.../" → 末尾の / が落ちる
await mkdir(dirname(target), { recursive: true });
await writeFile(target, data);               // ディレクトリ名の 0 byte ファイルができる
```

ZIP のディレクトリエントリ（名前が `/` で終わる、サイズ 0）を通常のファイルとして扱っている。`resolve()` が末尾のセパレータを落とすため、`ffmpeg-n8.1.2-.../` が `<dest>\ffmpeg-n8.1.2-...` という **0 byte のファイル**になる。続く `ffmpeg-.../bin/ffmpeg.exe` の展開で `mkdir(<dest>\ffmpeg-...\bin, { recursive: true })` が親をファイルとして見つけ、`EEXIST` で落ちる。

**実測ログ**（2026-08-25、`AudioSpike` の書き出し）:

```
失敗理由: hook-failed
詳細: [audio-remux:ffmpeg-acquire] EEXIST: file already exists, mkdir
      'C:\Users\...\unity-render-core\tools\ffmpeg\.staging-22092-1787655093861\ffmpeg-n8.1.2-44-g7c533d0f86-win64-lgpl-8.1'
```

BtbN の配布 zip はディレクトリエントリを含むため、この経路は**初回取得で確実に失敗する**。`tools/ffmpeg/` が空のまま残るので、再実行しても毎回同じところで落ちる。

**修正方針**: 名前が `/` で終わるエントリは `mkdir(target, { recursive: true })` して `continue` する。あわせて、ディレクトリエントリを含む zip の展開を回帰テストに加える（現行の `tests/audio-remux/ffmpeg/acquire.test.ts` のフィクスチャはディレクトリエントリを持たないため、この不具合を検出できていない）。

**暫定回避**: `%LOCALAPPDATA%\unity-render-core\tools\ffmpeg\manual\` に `ffmpeg.exe` と `ffprobe.exe` を置く。`ensureFfmpeg()` が最初に見る正規のフォールバック経路で、smoke test を通れば管理下ビルドより優先される。

## B-2. ファイル実体を持たない AudioClip 参照が Scene ごと失敗させる

**影響**: サブアセットの `AudioClip`（`.asset` 内に埋め込まれ、音声ファイルの実体を持たない）を Timeline が参照していると、その Scene が失敗する。

**実測ログ**（`AudioSpikeSources` の書き出し）:

```
失敗理由: hook-failed
詳細: [audio-remux:extract] metadata validation failed: validation-error
      (clips.4.sourceDurationSec: Too small: expected number to be >0)
```

`spike/timeline-audio/README.md` の Q-5 は、この参照形態を「`AssetDatabase.IsSubAsset()` が true かつ拡張子が音声形式でないことで検出できる。**これを error として記録する**」と書いている。実際にはクリップ単位の error 記録ではなく、`sourceDurationSec > 0` のスキーマ検証で弾かれて Scene 全体が落ちる。

**確認すべきこと**: 設計意図がクリップ単位のスキップ＋警告なのか、Scene 失敗なのか。前者なら抽出側で当該クリップを除外して警告に降格する。後者なら想定どおりなので、エラーメッセージを「音声ファイルの実体を持たない参照」と分かる文言にする（現状の `clips.4.sourceDurationSec` では利用者が原因を特定できない）。

## B-3. BOM 付き `manifest.json` で原因不明のエラーになる

**影響**: 軽微。Unity は BOM を付けないため通常は踏まない。

`Packages/manifest.json` が BOM 付き UTF-8 だと `patchManifest()` の `JSON.parse` が落ち、`Temporary package addition failed.` としか表示されない（`src/project-guard/manifest-patch.ts:57-62` が `cause` を握り潰している）。原因が追えないので、`cause` のメッセージを表示に含めるか、読み込み時に BOM を除去する。

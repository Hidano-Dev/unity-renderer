# バックログ

着手前の未修正事項。実機検証やレビューで見つかったが、その場のブランチのスコープ外だったものを記録する。修正したものはここから外す。

## B-3. BOM 付き `manifest.json` で原因不明のエラーになる

**影響**: 軽微。Unity は BOM を付けないため通常は踏まない。

`Packages/manifest.json` が BOM 付き UTF-8 だと `patchManifest()` の `JSON.parse` が落ち、`Temporary package addition failed.` としか表示されない（`src/project-guard/manifest-patch.ts:57-62` が `cause` を握り潰している）。原因が追えないので、`cause` のメッセージを表示に含めるか、読み込み時に BOM を除去する。

## 解決済み

| ID | 内容 | 対応 |
|---|---|---|
| B-1 | ZIP 展開がディレクトリエントリをファイルとして書き、ffmpeg 取得が必ず失敗する | `extractZip()` が名前を区切りで終えるエントリを `mkdir` して次へ進むよう修正（`fix/ffmpeg-zip-and-subasset-clips`） |
| B-2 | ファイル実体を持たない AudioClip 参照が Scene ごと失敗させる | 抽出側で当該クリップをエントリに出さないよう修正。設計どおり Scene 失敗のまま、原因がサブアセット参照だと分かる文面になる（同上） |
| B-4 | ffmpeg 取得ロックの競合で CI が約 50% 失敗する | 回収権 `.acquire.lock.takeover` で残骸ロックの削除を排他（PR #3） |

# HANDOVER

## 今回やったこと

- **Scene 選択 GUI を新規実装**（非エンジニアがコマンドを打たずに書き出せるようにする目的）
  - ブランチ `feature/scene-selection-gui`（`origin/main` から分岐）、コミット `cff8605`、**push 未実施・PR 未作成**
  - `unity-render gui` サブコマンド追加。ローカルサーバーを起動して既定ブラウザーに設定画面を開く
  - `unity-render-gui.bat` をリポジトリルートに追加（ダブルクリック起動用、ASCII のみ）
- 機能: Scene 一覧（`Assets` 配下の `.unity` を再帰列挙）／チェックボックス選択／すべて ON・OFF／選択状態の自動保存と復元／出力設定（出力先・ファイル名・解像度・フレームレート・形式）／事前チェック・書き出し実行＋ログのライブ表示
- 検証済み:
  - 新規テスト 46 件追加、フルスイート **267 件 pass**、`biome check` ✓ / `tsc --noEmit` ✓ / `artgraph check --diff` ✓
  - `pnpm build` で exe 再生成 → `dist\unity-render.exe gui` を起動し、**ブラウザーで実操作して確認**
  - `spike/unity-project` の Scene 4 件の列挙 → すべて ON → **事前チェック成功**（`Check passed: Unity CLI 1.0.0-beta.5, Editor 6000.0.36f1, 4 scene(s).`）→ リロード後の選択復元まで確認
- PR #2（audio-remux）は **main にマージ済み**（`30684d6`）。マージ後に届いた 3 巡目レビュー 4 件はユーザー判断で**無視**

## 決定事項

- GUI 方式は **Bun + ローカルサーバー + ブラウザー UI**。`node:http` を使用（`Bun.serve` は型が無いため不使用）。依存追加ゼロ、既存の `bun build --compile` にそのまま乗る
- **設定の保存先を 2 つに分離**
  - GUI の入力内容 → `%LOCALAPPDATA%\unity-render-core\gui-state.json`（変更のたび自動保存、400ms デバウンス）
  - 実行用設定 → 実行時に `render-config.json` を生成（cwd 基準。`.gitignore` に追加済み）
  - 理由: `renderConfigSchema` は `scenes` に最低 1 件を要求するため、「すべて OFF」を設定 JSON へ書き戻せない
- 設定の妥当性判定は必ず `validateRenderConfig` を通す。GUI 専用の緩い検証は作らない（GUI で通ったのに `render` で落ちる設定を作らせないため）
- **同名 Scene は選択不可**にして理由を表示（設定は Scene 名指定のため `resolveScenes` が `scenes-ambiguous` になる）
- セキュリティ: ループバック bind に加え、**起動ごとのトークン必須**（URL の `?t=` / `x-gui-token` ヘッダー）＋ Host が loopback かの検査。`/api/run` は Unity Editor を起動できるため
- 実行は 1 本に直列化（Pipeline のポート 7800 固定という既存制約に合わせる）
- `scene-resolver.ts` から `listSceneFiles` を export し、GUI 一覧と `resolveScenes` が同じ走査を共有
- hook 合成は `src/cli/composition.ts` へ分離（`index.ts -> gui.ts -> index.ts` の循環 import 回避）。`index.ts` からの re-export は既存テスト互換のため維持

## 捨てた選択肢と理由

- **PowerShell WinForms によるネイティブ GUI** → ビルド不要な利点はあるが、TS のロジックを再利用できず vitest でテストできない。artgraph のトレーサビリティからも外れる
- **Electron** → 依存が重すぎる。単一 exe 配布という既存方針と合わない
- **GUI の状態を `render-config.json` に相乗り** → 「すべて OFF」でスキーマ違反になり、CLI から読めない設定ファイルが残る（上記「決定事項」参照）
- **`webkitdirectory` によるブラウザー側フォルダー選択** → 絶対パスが取れない。サーバー側から PowerShell の `FolderBrowserDialog` を出す方式にした
- **`fetch` での SSE テスト** → undici で読み出しが返らない。`node:http` の生クライアントで検証する方式に変更
- **レビュー 3 巡目の P1 2 件の修正** → マージ済み PR に対する指摘のためユーザー判断で見送り（指摘自体はコード上実在を確認済み。下記「学び」参照）

## ハマりどころ

- **`response.writeHead()` だけでは SSE のヘッダーが送られない** → 最初のイベントが起きるまでブラウザーの `EventSource` 接続が確立しない。`response.flushHeaders()` の追加で解決（**実装のバグ**であってテストの問題ではなかった）
- `fetch` は `Host` ヘッダーを設定できない（forbidden header）。Host 検査のテストは `node:http` で書く必要がある
- `vi.fn(async () => {})` は引数型が `[]` に推論され、`mock.calls[0][1]` が型エラーになる。`vi.fn(async (_a: T, _b: U) => {})` と明示する（vitest 実行自体は通るので `tsc` で初めて出る）
- ブラウザー操作でクリック座標がずれる。スクロール位置が変わっていると `computer` のクリックが空振りする。DOM 直接操作（`javascript_tool`）で検証したほうが確実
- `tests/audio-remux/ffmpeg/acquire.test.ts` が**フルスイート実行時に 1 度だけ失敗**（単体では 4 連続 pass、フル再実行も pass）。並列実行時のタイミング依存フレークと思われる。**今回の変更とは無関係**（audio-remux 側の潜在的な不安定さ）
- PowerShell 5.1 は native コマンドの stderr を ErrorRecord にするため、`pnpm typecheck` 等の出力が読みづらい。`$out = & npx tsc --noEmit 2>&1 | Out-String` の形で受けると扱いやすい

## 学び

- `unity-render.exe` はダブルクリックでは動かない（引数なしだと usage を出して exit 1、ウィンドウが即閉じる）。非エンジニア向けには `.bat` ランチャーか GUI が必須
- exe の Japanese stdout は cmd のコードページ次第で化ける。`.bat` に `chcp 65001 >nul` を入れて回避（`.bat` 本体は ASCII のみを維持）
- マージ済み PR #2 の 3 巡目レビュー 4 件は、コード上いずれも実在を確認した。将来 audio-remux を触るときの参考として:
  - **P1** `extract-audio.cs:215` — `sourceSampleRate` が `audio.frequency`（インポート後の値）。ffmpeg は元ファイルをデコードするため、AudioImporter で sample rate を上書きしていると `filter-graph.ts:36` の `asetrate` が誤った速度になる（`speed !== 1` かつ `pitchMode="resample"` のときのみ発火）
  - **P1** `extract-audio.cs:232` — ControlTrack 分岐に `IsMutedInHierarchy` の確認が無い（AudioTrack 側は 146 行目で確認済み）。ミュートした ControlTrack 配下の音声が成果物でだけ鳴る
  - **P2** `acquire.ts:315` ロック公開の原子性 / `run.ts:86` Scene 別デバッグファイル分離

## 次にやること

1. **【最優先】書き出し実行の実機確認** — GUI から `render` を実際に走らせ、Unity Editor 起動 → 録画 → 音声合成 → 出力までを通す。今回は Editor を実際に起動する影響を考えて未実施（事前チェックまでは成功）
   ```powershell
   cd D:\Personal\Repositries\unity-renderer
   .\unity-render-gui.bat        # または .\dist\unity-render.exe gui
   ```
   確認したい点: 進捗ログが画面に流れるか／実行中にボタンが無効化されるか／失敗時に終了コード別の日本語メッセージ（特に exit 3 の manifest 復元失敗）が出るか／複数 Scene バッチの表示
2. 実機確認が通ったら **push と PR 作成**（`git push -u origin feature/scene-selection-gui` → `gh pr create`）
3. 余力があれば: `render` 実行中の中断（キャンセル）ボタン、`range`（切り出し）の GUI 対応、`debug` チェックボックス

## 関連ファイル

新規:

- `src/gui/server.ts` — ローカルサーバー、ルーティング、トークン／Host 検査、SSE
- `src/gui/page.ts` — GUI 本体（HTML/CSS/JS を 1 ファイルに内包、外部 CDN 不使用）
- `src/gui/state.ts` — GUI 状態の永続化とサニタイズ
- `src/gui/scenes.ts` — Scene 一覧の構築（同名検出）
- `src/gui/config-draft.ts` — GUI 入力 → `RenderConfig` の組み立てと検証
- `src/gui/runner.ts` — 実行管理、ログのイベント配信、直列化
- `src/gui/folder-picker.ts` — PowerShell の FolderBrowserDialog 呼び出し
- `src/cli/gui.ts` — `gui` サブコマンドの実体（listen、ブラウザー起動、終了処理）
- `src/cli/composition.ts` — hook 合成（循環 import 回避のため分離）
- `unity-render-gui.bat` — ダブルクリック起動用ランチャー
- `tests/gui/*.test.ts` — 46 件

変更:

- `src/cli/index.ts` — `gui` コマンド登録、`createCompositionHooks` の re-export
- `src/project-guard/scene-resolver.ts` — `listSceneFiles` を export
- `docs/setup.md` — 「4-b. コマンドを使わない場合（GUI）」を追加
- `.gitignore` — `render-config.json` を追加

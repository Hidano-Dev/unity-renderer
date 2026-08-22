# Multi-Spec Plan: unity-render-tool

- 生成日: 2026-08-22
- 元セッション: Unity プロジェクトを外部から操作し、任意 Scene の Timeline を Unity Recorder で映像書き出しする Windows 向け CLI ツールの要件定義ブレスト
- Status 欄は /kiro:spec-init-batch が更新する。手で編集して並び替え・追加・削除してもよい。

## 全体コンテクスト

Unity プロジェクトの**外部**から、PlayableDirector を含む任意の Scene を指定して Unity Recorder による映像書き出しを行うツールを作る。ツール本体は TypeScript 製の CLI（Windows 用実行ファイル）。Unity プロジェクト側には一切の恒久的変更を残さない（＝実行後に `git status` がクリーン。`Library/` 等の Unity 管理ディレクトリは対象外）。

実行フローの全体像:

1. ツールが設定ファイル（JSON）を読み込み、バッチ対象の Scene 名一覧を検証（不足があれば即エラー停止）
2. Unity Hub / Unity Editor を自動検出し、プロジェクトの Unity バージョン（`ProjectSettings/ProjectVersion.txt`）と一致確認。不一致なら「`unity install` でインストール」か「中断」かをユーザーに確認
3. `manifest.json` / `packages-lock.json` をバックアップし、`com.unity.recorder`（未導入の場合）と `com.unity.pipeline` を一時追加
4. 公式 **Unity CLI**（`unity open`）で Editor を GUI モードで起動し、`unity command eval`（Roslyn REPL、localhost:7800 の HTTP API）で C# を注入なしに実行
5. eval 経由で: Scene を開く → ルート階層の PlayableDirector を検出 → その TimelineAsset にメモリ上のみで RecorderTrack / RecorderClip を構築（アセット化しない）→ 解像度・フレームレートを一時上書き → 書き出し実行
6. 書き出し完了後・Editor 終了前に、Timeline の音声再生情報を抽出（Spec 2 の領域）
7. Editor をシーン・アセット**未保存のまま**終了し、manifest 等をバックアップから復元
8. 同梱 ffmpeg で音声を外部合成し、最終映像ファイルを完成させる（Spec 2 の領域）

CLI を先行し、Web UI（ローカルサーバ + ブラウザ）は将来スコープ。対応 OS は当面 Windows のみ。

参考記事（発案者本人の執筆。音ズレ・フレームスワップ問題の根拠）: https://zenn.dev/n_hidano/articles/eb184faaa395fd

Unity CLI の一次情報:
- https://unity.com/blog/meet-the-unity-cli
- https://docs.unity.com/en-us/unity-cli/use-unity-cli
- https://docs.unity.com/en-us/unity-production-pipeline/local-tools-cli/unity-pipeline-package

## 共通の決定済み事項

| ID  | 決定 | 理由 |
|-----|------|------|
| G-1 | 外部 C# 実行は公式 Unity CLI の `unity command eval` を採用（`com.unity.pipeline` パッケージ経由、Roslyn REPL） | プロジェクトへの C# スクリプト注入を避けたい、という最優先の制約を満たす唯一の公式手段 |
| G-2 | 対応 Unity バージョンは **6.0 以降のみ**。Render Pipeline は Built-in / URP / HDRP すべて対応 | `com.unity.pipeline` が Unity 6.0+ 必須のため。それ以外に意図的なバージョン制約は設けない |
| G-3 | `manifest.json` / `packages-lock.json` への一時パッケージ追加（`com.unity.recorder`, `com.unity.pipeline`）を許容し、終了後に**バックアップコピーから復元**して変更を破棄 | 完全非介入は技術的に不可能。git に依存しない復元方式なら未コミット変更があるプロジェクトでも安全 |
| G-4 | ツール／Editor クラッシュ時の復旧: 次回起動時に前回のバックアップ残骸を検出して復元する | 原状復帰の保証を異常系にも拡張する（ユーザー合意済み） |
| G-5 | Editor は **GUI モードで自動起動**（`-batchmode -nographics` は使わない） | Unity Recorder の MovieRecorder は GPU レンダリング必須で headless 不可 |
| G-6 | Unity Hub / Editor は自動検出。バージョン不一致時は `unity install` によるインストール実行か中断かをユーザーに確認 | PC 内のどこからでも実行できるツールにする。Hub のインストール情報から列挙可能 |
| G-7 | Unity アカウント認証（`unity auth login`）は初回セットアップ手順としてドキュメント化し、ツール本体は「認証済み前提」で動作 | 認証フローの自動化はスコープ外（ユーザー合意済み） |
| G-8 | RecorderTrack / RecorderClip / RecorderSettings はメモリ上のみで構築し、シーン・アセットは一切保存せず Editor を終了 | プロジェクト非介入の原則。書き出し後の保存は不要 |
| G-9 | フレームスワップ対策として `AsyncGPUReadback.WaitAllRequests()` による同期化を**常に有効**（書き出し時間 約1.5倍を許容） | 記事で実証済みの品質問題（フレーム順序の入れ替わり）。品質優先で無効化オプションは設けない |
| G-10 | 音声は Unity Recorder では収録しない。Timeline の音声情報を抽出し、書き出し後に同梱 ffmpeg で外部合成する | Unity Editor 再生の音は必ずミリ秒単位でランダムにズレる（記事で実証済み）。「Unity に音を託してはいけない」 |
| G-11 | 進捗表示のデフォルトは「実行中の Scene / 成否 / 所要時間 / 書き出しファイルをエクスプローラーで開くリンク」のみ。デバッグモード有効時に Unity / ffmpeg のログを出力 | 通常利用はシンプルに、トラブルシュートは開発者向けモードで |
| G-12 | 設定は JSON ファイルで保存・再読み込みできればよい（ミニマム）。プリセット管理の高度化はスコープ外 | 初期リリースは最小構成 |
| G-13 | 出力ファイル名は Unity Recorder のワイルドカード（`<Scene>`, `<Take>`, `<Recorder>` 等）を一式サポートし、ユーザー編集も Recorder 準拠 | Recorder ユーザーの既存知識をそのまま活かす |
| G-14 | Unity CLI は experimental であることをリスクとして明記し、最初の実装タスクは「eval 経由で RecorderTrack 追加〜書き出しが通るか」の検証スパイクとする | ここが通らないと全体が成立しない。破壊的変更リスクの早期検知 |

## 検討して捨てた選択肢

| 選択肢 | 捨てた理由 |
|--------|-----------|
| エディタスクリプト／ローカル UPM パッケージを一時注入して `-executeMethod` で実行 | プロジェクトへのコード注入は極力避けたいというユーザー方針。Unity CLI の eval で代替可能と確認済み |
| Unity Recorder で音声も収録する | Editor 再生の音声は必ずズレる（記事で実証）。外部 ffmpeg 合成に方針決定 |
| `-batchmode` / headless での書き出し | MovieRecorder が GPU レンダリング必須のため動作しない |
| Unity 6 未満（2021/2022 LTS）への対応 | `com.unity.pipeline`（eval の前提）が Unity 6.0+ 必須 |
| Web アプリ先行での提供 | Unity の起動はローカル必須であり、まず CLI を固めてから UI を後付けする方が低リスク |
| Recorder 未導入プロジェクトを非対応とする | manifest.json の一時追加＋復元を許容することで対応範囲を広げられる |
| 同名 Scene・複数 PlayableDirector を黙って処理 | Scene はバッチ前の一括存在チェックで不足時に即エラー。ルート階層に PlayableDirector が複数ある場合のみ警告して最初の 1 つを使用 |

## Spec 一覧（推奨実行順）

| # | Spec | Status  | 依存 |
|---|------|---------|------|
| 1 | unity-render-core   | DONE | -    |
| 2 | timeline-audio-remux | IN_PROGRESS | #1   |

---

## Spec: unity-render-core

- Status: DONE
- Feature dir: .kiro/specs/unity-render-core/
- 依存: なし

### 概要

Unity プロジェクト外部から Scene 名を指定し、Unity CLI（`unity open` / `unity command eval`）で Editor を駆動して Unity Recorder による映像書き出しを行う TypeScript 製 Windows CLI。Unity/Hub の自動検出、パッケージの一時追加と原状復帰、メモリ上での RecorderTrack/RecorderClip 構築、バッチ実行と進捗表示までを含むツールの本体。

### スコープ (in)

- TypeScript 製 CLI（Windows 用。単体実行ファイルとして配布可能な形態）
- JSON 設定ファイル: 対象 Scene 名一覧、書き出し範囲（デフォルト Timeline 全長、オプションでイン点／アウト点）、解像度、フレームレート、出力フォーマット、出力先パス＋ファイル名（Recorder ワイルドカード一式対応）、デバッグモードフラグ
- Unity Hub / Editor の自動検出と、プロジェクトバージョンとの一致チェック（不一致時: `unity install` 実行 or 中断のユーザー確認）
- バッチ実行前の全 Scene 存在チェック（Scene 名でプロジェクト内を検索。不足があれば即エラー停止してユーザーに修正を求める）
- `manifest.json` / `packages-lock.json` のバックアップ → `com.unity.recorder` / `com.unity.pipeline` 一時追加 → 終了後復元。クラッシュ時の次回起動時復旧を含む
- `unity open` による Editor GUI 起動と `com.unity.pipeline`（localhost:7800）への接続
- eval で実行する C# コード群: Scene オープン、ルート階層の PlayableDirector 検出（入れ子の PlayableDirector は対象外。ルート階層に複数あれば警告して最初の 1 つ）、RecorderTrack/RecorderClip のメモリ上構築、Timeline 実効フレームレート・解像度の一時上書き、`AsyncGPUReadback.WaitAllRequests()` 同期化、書き出し実行と完了検知
- シーン・アセット未保存での Editor 自動終了
- 進捗表示（G-11 準拠）、終了コードによる成否判定、タイムアウトによるハング Editor の強制終了、プロジェクトロック競合（別 Editor で開かれている）のエラー処理
- Spec 2 が使うジョブフロー上のフック地点（書き出し完了後・Editor 終了前に追加の eval を実行できる拡張点）と、成果物（映像ファイルパス等）の受け渡し

### スコープ (out)

- 音声の抽出・合成一切（timeline-audio-remux が担当。本 Spec の書き出し映像は無音でよい）
- Web UI / ローカルサーバ
- macOS / Linux 対応
- プリセット管理・設定 GUI
- Unity 6 未満のプロジェクト対応

### この Spec 固有の決定済み事項

| ID  | 決定 | 理由 |
|-----|------|------|
| S1-1 | Scene はファイルパスではなく **Scene 名のみ**で指定し、プロジェクト内を検索して解決する | ユーザーの運用イメージ。パス指定より簡便 |
| S1-2 | 解像度・フレームレートはツール側の設定で指定し、Timeline の実効レートを一時的に変更する | Timeline 側の設定に依存せず出力を統一する |
| S1-3 | 複数 Scene のバッチはキューで直列実行 | Editor 起動は排他的。並列実行は初期スコープ外 |
| S1-4 | 最初のタスクは Unity CLI eval で Recorder を駆動できるかの**検証スパイク**（G-14） | experimental な基盤の成立性を最初に確認する |

### 未決事項（dig で確認すべき候補）

- 出力フォーマットの初期対応範囲: MP4 のみで始めるか、MOV(ProRes) / PNG・EXR 連番も初期リリースに含めるか
- CLI のコマンド体系: サブコマンド構成（`render`, `check`, `init` 等）と引数設計
- 実行ファイル化の方式（Node SEA / bun compile / pkg 等）と配布形態
- `unity command eval` に渡せる C# のサイズ・複雑さの制約（長い処理をどう分割・送信するか。検証スパイクで確認する項目）
- 書き出し完了の検知方式（eval でのポーリング / Recorder のコールバック / ログ監視）
- タイムアウトの既定値と設定可否
- 複数 Scene バッチで Editor を Scene ごとに再起動するか、1 起動で連続処理するか（Play Mode の状態汚染との兼ね合い）

### 他 Spec とのインターフェース

- timeline-audio-remux に対して提供するもの:
  - ジョブフローのフック地点（書き出し完了後・Editor 終了前に追加の eval を実行できる拡張点）
  - 書き出した映像ファイルの絶対パス
  - 書き出しに使った実効フレームレート・イン/アウト点（音声の切り出し範囲計算に必要）
- 音声メタデータの JSON スキーマ定義は timeline-audio-remux 側の責務

---

## Spec: timeline-audio-remux

- Status: IN_PROGRESS
- Feature dir: (spec-init-batch が記入)
- 依存: unity-render-core

### 概要

Timeline（ControlTrack による入れ子構造を含む）のすべての AudioTrack から再生情報を抽出し、映像書き出し後に同梱 ffmpeg で音声をブレンドして映像ファイルへ合成する。Unity Editor 再生時の音ズレ（ミリ秒単位のランダムなズレ）を根本回避するための、本ツールの核心的差別化機能。

### スコープ (in)

- eval で実行する音声情報抽出 C# コード: ルート Timeline から ControlTrack を再帰的に辿り、**全階層の AudioTrack** を走査。各オーディオクリップについて「音源アセットの元ファイルパス（Assets 内の .wav/.mp3 等）」「ルート Timeline 基準の絶対開始時刻」「clipIn（頭出しオフセット）」「音量」を抽出し、JSON で出力
- 複数音源の同時再生のブレンド（ネスト Timeline により同時発音が普通に起きる前提でのミックス）
- 同梱 ffmpeg による合成: 抽出情報から各音源を配置・ミックスし、unity-render-core が書き出した映像ファイルに mux して最終ファイルを生成
- イン点／アウト点指定時の音声切り出しとの整合（映像範囲と同じ区間の音声を合成）
- ffmpeg のツールへの同梱（ユーザーの PATH に依存しない）
- デバッグモード時の ffmpeg ログ出力

### スコープ (out)

- Scene 内に直接置かれた AudioSource（Timeline 外の音）
- Timeline の AudioTrack 以外の発音（スクリプト再生、イベント駆動の SE 等）
- サラウンド / 空間音響（AudioSource の 3D 設定）の再現

### この Spec 固有の決定済み事項

| ID  | 決定 | 理由 |
|-----|------|------|
| S2-1 | 音声収集の対象は Timeline の AudioTrack のみ。ただし ControlTrack で入れ子になった**子 Timeline の AudioTrack もすべて**対象とし、同時再生をブレンドする | Scene で実行される全 AudioTrack の音が最終映像に含まれる必要がある（ユーザー明示の注意点） |
| S2-2 | 音源はアセットの元ファイル（.wav/.mp3 等）を直接参照する（Unity のインポート加工は無視） | 元データが最高品質。インポート設定の再現は割に合わない |
| S2-3 | ffmpeg はツールに同梱する **（→ dig で上書き: 同梱せず初回起動時に固定版を自動ダウンロード＋SHA-256 検証。spec の D-3 / D-4 参照）** | ユーザー環境への依存を無くす（PATH 非依存という目的は自動 DL 方式でも維持） |
| S2-4 | 再現する属性のミニマムは「絶対開始時刻 + clipIn + 音量」 | まず確実に合う音を出す。フェード等は拡張として検討 |

### 未決事項（dig で確認すべき候補）

- クリップのフェードイン／アウト、再生速度、AudioTrack 側ボリューム・ミュートをどこまで初期リリースで再現するか（S2-4 のミニマムから何を足すか）
- ControlClip 側の timeScale（子 Timeline が変速再生されるケース）を初期スコープに含めるか
- ループ設定されたオーディオクリップ（クリップ長 > 音源長）の扱い
- 出力音声のコーデック・サンプルレートの決め方（映像コンテナに応じた自動選択か、設定項目にするか）
- ffmpeg 同梱のライセンス面の整理（GPL/LGPL ビルドの選択と配布形態）
- 音声情報 JSON スキーマの詳細設計

### 他 Spec とのインターフェース

- unity-render-core から受け取るもの: 書き出し完了後・Editor 終了前の eval フック、映像ファイルパス、実効フレームレート、イン/アウト点
- unity-render-core に提供するもの: 音声メタデータ JSON のスキーマ定義と、フックで実行する抽出用 C# コード
- 最終成果物: 音声合成済みの映像ファイル（合成前の無音映像を置き換えるか別名保存かは design で決定）

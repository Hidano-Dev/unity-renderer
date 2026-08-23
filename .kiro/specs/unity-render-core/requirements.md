# Requirements Document

## Project Description (Input)
unity-render-core: Unity プロジェクト外部から Scene 名を指定し、公式 Unity CLI（unity open / unity command eval）で Editor を GUI モードで駆動して Unity Recorder による映像書き出しを行う TypeScript 製 Windows CLI ツールの本体。Unity Hub/Editor の自動検出とバージョン一致チェック、manifest.json/packages-lock.json のバックアップとパッケージ一時追加（com.unity.recorder / com.unity.pipeline）と原状復帰、メモリ上のみでの RecorderTrack/RecorderClip 構築、複数 Scene の直列バッチ実行と進捗表示までを含む。詳細な背景・決定済み事項・スコープ・未決事項は .kiro/multi-spec/unity-render-tool.md の「全体コンテクスト」「共通の決定済み事項」「Spec: unity-render-core」の各節に記載されており、requirements 生成・dig インタビュー・design の前提として必ず読み込むこと。

## Introduction

unity-render-core は、Unity プロジェクトの外部から Scene 名を指定し、公式 Unity CLI（`unity open` / `unity command eval`、plan G-1）で Unity Editor を GUI モードで駆動し（plan G-5）、Unity Recorder による映像書き出しを実行する TypeScript 製 Windows CLI ツールである。プロジェクトへの C# スクリプト注入を行わず、実行後にプロジェクトへ恒久的変更を残さない（`git status` がクリーン、`Library/` 等の Unity 管理ディレクトリは対象外）ことを最重要の原則とする。対応 Unity バージョンは 6.0 以降のみ（plan G-2）。

本書の主語 "unity-render-core CLI" は本ツールの CLI 本体（TypeScript 実装、およびそれが eval 経由で Editor 内に送り込み実行させる C# コードを含む）を指す。

## Boundary Context

- **In scope**: JSON 設定ファイルの読み込み・検証、Unity Hub/Editor の自動検出とバージョン一致チェック、バッチ前の Scene 存在チェック、`manifest.json`/`packages-lock.json` のバックアップ・一時パッケージ追加・復元・クラッシュ復旧、`unity open` による Editor GUI 起動と `com.unity.pipeline`（localhost:7800）接続、eval で実行する C# 一式（Scene オープン、PlayableDirector 検出、メモリ上 RecorderTrack/RecorderClip 構築、フレームレート・解像度上書き、`AsyncGPUReadback.WaitAllRequests()` 同期化、書き出し実行・完了検知）、未保存での Editor 終了、直列バッチキュー、進捗表示、終了コード、タイムアウト・ロック競合処理、出力ファイル名ワイルドカード、検証スパイク、timeline-audio-remux 向けフック・受け渡しインターフェース。
- **Out of scope**: 音声の抽出・合成一切（timeline-audio-remux が担当。本 Spec の書き出し映像は無音でよい）、Web UI / ローカルサーバ、macOS / Linux 対応、プリセット管理・設定 GUI、Unity 6 未満のプロジェクト対応、Unity アカウント認証フローの自動化（初回セットアップ手順としてドキュメント化する。plan G-7）。
- **Adjacent expectations**: timeline-audio-remux（Spec 2）は本 Spec が提供する「書き出し完了後・Editor 終了前の eval フック地点」「映像ファイルの絶対パス」「実効フレームレート」「イン/アウト点」を利用する。音声メタデータ JSON スキーマの定義は timeline-audio-remux 側の責務。

## Open Questions and Decisions (Dig)

| ID | トピック | 決定 | 理由 | リスク |
|----|---------|------|------|--------|
| D-1 | Editor のライフサイクル | 複数 Scene バッチでは **Scene ごとに Unity Editor を再起動**する（1 起動での連続処理はしない） | 各 Scene を完全にクリーンな Editor 状態で書き出し、Play Mode の状態汚染を構造的に排除する。バッチ所要時間の増加（Scene 数 × Editor 起動時間)は品質優先で許容 | 低（速度とのトレードオフを明示的に受容） |
| D-2 | 出力フォーマット初期範囲 | **MP4 + MOV(ProRes)** の 2 形式で開始する（WebM・連番出力は初期スコープ外） | 配信用（MP4）と編集ワークフロー用の高品質中間コーデック（ProRes）を初期から提供する。連番はジョブフローが分岐するため除外 | 中（ProRes の Recorder 設定と Spec 2 の ffmpeg mux 検証対象が 2 形式になる） |
| D-3 | 実行ファイル化方式 | **bun compile**（`bun build --compile`）で Windows 向け単一 .exe を生成する | ビルド構成が最も単純で、TS を直接単体実行ファイル化できる。子プロセス・HTTP クライアント程度の利用なら Node 互換差異のリスクは低い | 低 |
| D-4 | CLI コマンド体系 | **サブコマンド構成**: `render <config.json>`（書き出し実行）/ `check <config.json>`（Editor を起動しない事前検証: 設定・Scene 存在・Unity 検出のみ）/ `init`（設定ファイルの雛形生成） | 用途が明確で、将来の拡張（Web UI サーバ等）もサブコマンド追加で自然に足せる | 低 |
| D-5 | タイムアウト | 書き出しタイムアウトは**動的既定値**（Timeline 実長 × 係数 ＋ 固定マージン。係数・マージンは design で確定）、Editor 起動・接続は固定既定値。いずれも設定ファイルで上書き可 | 長尺 Timeline での誤検知と短尺でのハング検知遅れを両立して防ぐ | 中（算出式の妥当性は検証スパイク・実測で調整） |
| D-6 | 失敗時の出力残骸 | 書き出し失敗・タイムアウト時の不完全な出力ファイルは**自動削除**する。ただしデバッグモード有効時は調査用に保持する | 「出力先にファイルがある＝成功」の直感を保ち、不完全ファイルの誤用を防ぐ。デバッグ時は原因調査の材料を残す | 低 |

派生決定（D-1 に伴う整理）: `manifest.json` / `packages-lock.json` のバックアップはバッチ開始時に 1 回、復元はバッチ終了時に 1 回とする。Scene ごとの Editor 再起動の間もパッケージ一時追加状態は維持する（毎 Scene で追加・復元を繰り返すとドメインリロードが倍増するため）。

## Requirements

### Requirement 1: 検証スパイク（Unity CLI eval による Recorder 駆動の成立性確認）

**Objective:** 開発者として、実装着手前に Unity CLI eval 経由で RecorderTrack 追加〜映像書き出しが成立することを確認したい。experimental な基盤の上に全体を構築するリスクを最初に潰すためである（per plan G-14 / S1-4）。

#### Acceptance Criteria

1. The unity-render-core プロジェクト shall 最初の実装タスクとして「`unity command eval` 経由で RecorderTrack/RecorderClip をメモリ上に構築し映像書き出しが完了するか」を確認する検証スパイクを実施する
2. When 検証スパイクを実施する, the 検証スパイク shall 「eval に渡せる C# のサイズ・複雑さの制約（長い処理の分割・送信方法）」「書き出し完了の検知方式（Play Mode 突入・ドメインリロードを跨ぐ場合の挙動を含む）」「`AsyncGPUReadback.WaitAllRequests()` 同期化の外部からの設定可否」「Windows での MOV(ProRes) 出力可否」「localhost:7800 ポートの構成可否・衝突時挙動」の実測結果を記録する
3. If 検証スパイクで書き出しが成立しないことが判明した, then the unity-render-core プロジェクト shall 後続タスクの実装に進まず、代替方針の再検討をユーザーに提示する
4. The unity-render-core のドキュメント shall Unity CLI（`com.unity.pipeline`）が experimental であり破壊的変更のリスクがあることを明記する（per plan G-14）

### Requirement 2: JSON 設定ファイル

**Objective:** ユーザーとして、書き出しに必要な設定を JSON ファイルで保存・再読み込みしたい。同じバッチを繰り返し実行できるようにするためである（per plan G-12）。

#### Acceptance Criteria

1. The unity-render-core CLI shall 設定を JSON ファイルから読み込み、以下の項目をサポートする: 対象 Unity プロジェクトの指定、対象 Scene 名一覧、書き出し範囲（イン点／アウト点）、解像度、フレームレート、出力フォーマット（初期リリースは MP4 / MOV(ProRes) の 2 形式。see D-2）、出力先パスと出力ファイル名、デバッグモードフラグ、タイムアウト設定（書き出し・Editor 起動/接続の上書き値。いずれも任意。see D-5）
2. Where 設定に書き出し範囲（イン点／アウト点）が指定されていない, the unity-render-core CLI shall Timeline 全長を書き出し範囲とする
3. The unity-render-core CLI shall 解像度・フレームレートを設定ファイル側で指定させ、Timeline 側の設定に依存しない出力を行う（per plan S1-2）
4. When 設定ファイルに必須項目の欠落・型不正・不正値がある, the unity-render-core CLI shall Unity Editor を起動する前に、該当項目を特定できるエラーメッセージを表示して失敗終了する
5. The unity-render-core CLI shall プリセット管理等の高度な設定管理機能を提供しない（保存・再読み込みのミニマム構成とする。per plan G-12）

### Requirement 3: 出力ファイル名ワイルドカード

**Objective:** Unity Recorder ユーザーとして、使い慣れた Recorder のワイルドカードで出力ファイル名を指定したい。既存知識をそのまま活かすためである（per plan G-13）。

#### Acceptance Criteria

1. The unity-render-core CLI shall 出力ファイル名に Unity Recorder のワイルドカード一式（`<Scene>`, `<Take>`, `<Recorder>` 等）をサポートし、Recorder 準拠の規則で展開する
2. When ユーザーが設定ファイルでワイルドカードを含むファイル名を指定した, the unity-render-core CLI shall 書き出し実行時に各 Scene のコンテクストに応じて展開した実ファイル名で出力する

### Requirement 4: Unity Hub / Editor の自動検出とバージョン一致チェック

**Objective:** ユーザーとして、Unity のインストール場所を意識せず PC 内のどこからでもツールを実行したい。環境設定の手間なく正しい Editor で書き出すためである（per plan G-6）。

#### Acceptance Criteria

1. When バッチ実行を開始する, the unity-render-core CLI shall Unity Hub のインストール情報から利用可能な Unity Editor を自動検出する
2. The unity-render-core CLI shall 対象プロジェクトの `ProjectSettings/ProjectVersion.txt` から要求 Unity バージョンを読み取り、検出済み Editor との一致を確認する
3. If 一致する Unity Editor がインストールされていない, then the unity-render-core CLI shall 「`unity install` によるインストール実行」か「中断」かをユーザーに確認し、選択に従って処理する（per plan G-6）
4. When ユーザーがインストール実行を選択し `unity install` が成功した, the unity-render-core CLI shall インストールされた Editor を用いてバッチ実行を継続する
5. If ユーザーが中断を選択した、または `unity install` が失敗した, then the unity-render-core CLI shall プロジェクトへ変更を加えることなく失敗終了する
6. If 対象プロジェクトの Unity バージョンが 6.0 未満である, then the unity-render-core CLI shall 非対応バージョンである旨を表示して失敗終了する（per plan G-2）
7. When バッチ実行または `check` を開始する, the unity-render-core CLI shall 公式 Unity CLI（`unity` コマンド）の存在と実行可否を確認する
8. If 公式 Unity CLI が検出できない, then the unity-render-core CLI shall インストール手順（初回セットアップドキュメント参照）を含むエラーメッセージを表示して失敗終了する
9. If 標準入力が対話端末に接続されていない（CI 等の非対話環境）状態でバージョン不一致の確認（AC 3）に到達した, then the unity-render-core CLI shall 自動的に「中断」を選択して失敗終了する

### Requirement 5: バッチ実行前の Scene 存在チェック

**Objective:** ユーザーとして、設定した Scene 名の誤りをバッチ開始前にまとめて知りたい。長時間のバッチが途中で失敗する無駄を避けるためである。

#### Acceptance Criteria

1. The unity-render-core CLI shall Scene をファイルパスではなく Scene 名のみで受け取り、対象プロジェクト内を検索して Scene ファイルへ解決する（per plan S1-1）
2. When バッチ実行を開始する, the unity-render-core CLI shall Unity Editor を起動する前に、設定された全 Scene 名の存在チェックを一括で実行する
3. If 解決できない Scene 名が 1 つでも存在する, then the unity-render-core CLI shall 不足している Scene 名の一覧を提示して即エラー停止し、ユーザーに設定の修正を求める
4. If 同名の Scene がプロジェクト内で複数解決された, then the unity-render-core CLI shall 該当する Scene 名と候補パスの一覧を提示して即エラー停止し、ユーザーに設定の修正を求める

### Requirement 6: パッケージ一時追加・バックアップ・原状復帰・クラッシュ復旧

**Objective:** ユーザーとして、ツール実行後に Unity プロジェクトへ変更が残らないことを保証してほしい。プロジェクト非介入の原則を異常系まで含めて守るためである（per plan G-3 / G-4）。

#### Acceptance Criteria

1. When パッケージの一時追加を行う前, the unity-render-core CLI shall 対象プロジェクトの `manifest.json` と `packages-lock.json` をバックアップコピーとして保存する
2. When バックアップが完了した, the unity-render-core CLI shall `com.unity.recorder`（未導入の場合のみ）と `com.unity.pipeline` を `manifest.json` に一時追加する（per plan G-3）
3. When バッチ終了後の後処理を行う, the unity-render-core CLI shall `manifest.json` / `packages-lock.json` をバックアップコピーから復元し、一時追加による変更を破棄する（バックアップはバッチ開始時に 1 回・復元はバッチ終了時に 1 回。Scene ごとの Editor 再起動の間は一時追加状態を維持する。see D-1 派生決定）
4. If ツールまたは Unity Editor がクラッシュし復元が行われなかった, then the unity-render-core CLI shall 次回起動時に前回のバックアップ残骸を検出し、ユーザーに通知したうえで復元を実行する（per plan G-4）
5. When バッチが正常終了した, the unity-render-core CLI shall 対象プロジェクトに恒久的変更を残さない（実行前後で `git status` がクリーンであること。`Library/` 等の Unity 管理ディレクトリは対象外）
6. If バックアップの保存に失敗した, then the unity-render-core CLI shall パッケージの一時追加を行わずに失敗終了する

### Requirement 7: Editor の GUI 起動と Unity CLI 接続

**Objective:** ツールとして、公式 Unity CLI 経由で Editor を GUI モードで起動・接続したい。C# スクリプト注入なしに、GPU レンダリングを要する Recorder を駆動するためである（per plan G-1 / G-5）。

#### Acceptance Criteria

1. When 書き出し対象の処理を開始する, the unity-render-core CLI shall `unity open` により対象プロジェクトの Unity Editor を GUI モードで自動起動する（`-batchmode` / `-nographics` は使用しない。per plan G-5）
2. When Editor が起動した, the unity-render-core CLI shall `com.unity.pipeline` が提供する HTTP API（localhost:7800）への接続を確立し、以降の C# 実行を `unity command eval` で行う（per plan G-1）
3. If 規定時間内に localhost:7800 への接続が確立できない, then the unity-render-core CLI shall Editor プロセスを終了させ、原因調査の手掛かり（デバッグモードでのログ参照等）を含むエラーを表示して当該 Scene を失敗として扱う
4. The unity-render-core CLI shall Unity アカウント認証（`unity auth login`）は済んでいる前提で動作し、認証手順は初回セットアップドキュメントに記載する（per plan G-7）
5. If 対象プロジェクトが別の Unity Editor によって開かれている（プロジェクトロック競合）, then the unity-render-core CLI shall 競合を検知し、対象プロジェクトを閉じるよう促すエラーメッセージを表示して失敗終了する

### Requirement 8: Scene オープンと PlayableDirector 検出（eval 実行）

**Objective:** ツールとして、eval 経由で対象 Scene を開き書き出し対象の Timeline を特定したい。ユーザーの手作業なしに正しい PlayableDirector を選ぶためである。

#### Acceptance Criteria

1. When Scene の処理を開始する, the unity-render-core CLI shall eval 経由で対象 Scene を Editor 上で開く
2. When Scene が開かれた, the unity-render-core CLI shall Scene のルート階層から PlayableDirector を検出する（入れ子階層の PlayableDirector は検出対象外）
3. If ルート階層に PlayableDirector が複数存在する, then the unity-render-core CLI shall 警告を表示したうえで最初の 1 つを書き出し対象として使用する
4. If ルート階層に PlayableDirector が 1 つも存在しない, then the unity-render-core CLI shall 当該 Scene を失敗として記録し、バッチキューの次の Scene へ進む

### Requirement 9: メモリ上での Recorder 構成と設定の一時上書き

**Objective:** ツールとして、Recorder の構成をメモリ上のみで組み立てたい。プロジェクトのシーン・アセットへ一切の変更を保存しないためである（per plan G-8）。

#### Acceptance Criteria

1. When 書き出し対象の PlayableDirector が確定した, the unity-render-core CLI shall その TimelineAsset に対し RecorderTrack / RecorderClip / RecorderSettings をメモリ上のみで構築し、アセットとして保存しない（per plan G-8）
2. When Recorder 構成を構築する, the unity-render-core CLI shall 設定ファイルで指定された解像度・出力フォーマット・出力ファイル名（ワイルドカード展開込み）を RecorderSettings に適用する
3. When Recorder 構成を構築する, the unity-render-core CLI shall Timeline の実効フレームレートを設定ファイルで指定された値に一時的に上書きする（per plan S1-2）
4. Where 設定にイン点／アウト点が指定されている, the unity-render-core CLI shall RecorderClip の記録範囲を指定区間に設定する
5. While 書き出しを実行している, the unity-render-core CLI shall `AsyncGPUReadback.WaitAllRequests()` による同期化を常に有効にする（無効化オプションは提供しない。書き出し時間 約 1.5 倍を許容する。per plan G-9）
6. The unity-render-core CLI shall 音声を Unity Recorder では収録しない（書き出し映像は無音でよい。音声は timeline-audio-remux の責務。per plan G-10）

### Requirement 10: 書き出し実行と完了検知

**Objective:** ユーザーとして、書き出しが正常に完了したこと（または失敗したこと）を確実に判定してほしい。不完全な出力ファイルを成功と誤認しないためである。

#### Acceptance Criteria

1. When Recorder 構成の適用が完了した, the unity-render-core CLI shall eval 経由で Timeline の書き出しを開始する
2. While 書き出しが進行中である, the unity-render-core CLI shall 書き出しの完了・失敗を検知する仕組みを持つ（検知方式は検証スパイクの結果に基づき design で決定する）
3. When 書き出しが完了した, the unity-render-core CLI shall 出力ファイルが実際に生成されていることを確認したうえで当該 Scene を成功として記録する
4. If 書き出しが失敗した、または完了検知後に出力ファイルが存在しない, then the unity-render-core CLI shall 当該 Scene を失敗として記録し、バッチキューの次の Scene へ進む
5. If 書き出し処理が設定されたタイムアウト時間を超過した, then the unity-render-core CLI shall ハングした Unity Editor プロセスを強制終了して当該 Scene を失敗として記録し、後続 Scene が残る場合はパッケージ一時追加状態を維持したまま次の Scene へ進む。原状復帰（Requirement 6 の復元）はバッチ終了時の後処理として必ず実行されることを保証する
6. The unity-render-core CLI shall 書き出しタイムアウトの既定値を書き出し区間の実長に基づき動的に算出し（算出式は design で確定）、Editor 起動・接続タイムアウトは固定既定値とする。いずれも設定ファイルで上書きできる（see D-5）
7. If 書き出しが失敗またはタイムアウトした, then the unity-render-core CLI shall 不完全な出力ファイルを自動削除する。Where デバッグモードが有効である, the unity-render-core CLI shall 不完全な出力ファイルを調査用に保持する（see D-6）

### Requirement 11: Editor の未保存終了

**Objective:** ツールとして、書き出し後に Editor をシーン・アセット未保存のまま自動終了したい。メモリ上の一時変更をプロジェクトへ残さないためである（per plan G-8）。

#### Acceptance Criteria

1. When 書き出しと Editor 終了前フック（Requirement 14）の実行が完了した, the unity-render-core CLI shall シーン・アセットを一切保存せずに Unity Editor を自動終了させる
2. If Editor が保存確認ダイアログ等で終了をブロックした、または規定時間内に終了しない, then the unity-render-core CLI shall Editor プロセスを強制終了してジョブフローを継続する（後続 Scene が残る場合はパッケージ一時追加状態を維持し、原状復帰（Requirement 6 の復元）はバッチ終了時の後処理として必ず実行されることを保証する）

### Requirement 12: 複数 Scene の直列バッチ実行

**Objective:** ユーザーとして、複数 Scene の書き出しを 1 コマンドでまとめて実行したい。Scene ごとの手動操作を排するためである（per plan S1-3）。

#### Acceptance Criteria

1. The unity-render-core CLI shall 設定された複数 Scene をキューに積み、直列で 1 Scene ずつ処理する（並列実行は行わない。per plan S1-3）
2. If ある Scene の処理が失敗した, then the unity-render-core CLI shall バッチ全体を中断せず、失敗を記録してキューの次の Scene の処理を継続する
3. When バッチ内の全 Scene の処理が終了した, the unity-render-core CLI shall Scene ごとの成否一覧を表示してから終了処理（原状復帰）に進む
4. The unity-render-core CLI shall Scene ごとに Unity Editor を再起動する（前の Scene の書き出しで用いた Editor プロセスを終了してから次の Scene 用に新規起動し、Play Mode の状態汚染を排除する。see D-1）

### Requirement 13: 進捗表示・デバッグモード・終了コード

**Objective:** ユーザーとして、通常はシンプルな進捗だけを見たい。一方でトラブル時には詳細ログで原因を追えるようにしたい（per plan G-11）。

#### Acceptance Criteria

1. While バッチを実行している, the unity-render-core CLI shall デフォルトの進捗表示として「実行中の Scene」「成否」「所要時間」「書き出しファイルをエクスプローラーで開くリンク」のみを表示する（per plan G-11)
2. Where デバッグモードが有効である, the unity-render-core CLI shall Unity のログを出力に含める（per plan G-11）
3. While デバッグモードが無効である, the unity-render-core CLI shall Unity の詳細ログを進捗表示に混在させない
4. When 全 Scene の書き出しと原状復帰が成功して終了した, the unity-render-core CLI shall 終了コード 0 で終了する
5. If 1 つ以上の Scene が失敗した、または実行前検証・原状復帰でエラーが発生した, then the unity-render-core CLI shall 非 0 の終了コードで終了し、CI 等の呼び出し元が成否を判定できるようにする

### Requirement 14: timeline-audio-remux 向けインターフェース

**Objective:** timeline-audio-remux（Spec 2）として、書き出し完了後・Editor 終了前に追加処理を差し込み、合成に必要な情報を受け取りたい。音声の抽出・合成を本 Spec の成果物に接続するためである。

#### Acceptance Criteria

1. The unity-render-core CLI shall ジョブフロー上に「書き出し完了後・Editor 終了前」のフック地点を提供し、その地点で追加の eval（C# コード）を実行できる拡張点を持つ
2. When Scene の書き出しが成功した, the unity-render-core CLI shall 後続処理（timeline-audio-remux）へ「書き出した映像ファイルの絶対パス」「書き出しに使った実効フレームレート」「イン点／アウト点」を受け渡す
3. Where フックに追加の eval 処理が登録されていない, the unity-render-core CLI shall フック地点をスキップして通常のジョブフローを継続する
4. If フックで実行された追加処理が失敗した, then the unity-render-core CLI shall 失敗を記録し、Editor の未保存終了（Requirement 11）を必ず実行する。原状復帰（Requirement 6 の復元）はバッチ終了時の後処理として保証する

### Requirement 15: CLI コマンド体系と配布形態

**Objective:** ユーザーとして、明確なコマンド体系の単体実行ファイルとしてツールを使いたい。Node/Bun のインストールなしに PC 内のどこからでも実行するためである（see D-3 / D-4）。

#### Acceptance Criteria

1. The unity-render-core CLI shall `render <config.json>`（書き出し実行）、`check <config.json>`（事前検証のみ）、`init`（設定ファイル雛形の生成）のサブコマンドを提供する（see D-4）
2. When `check` サブコマンドが実行された, the unity-render-core CLI shall Unity Editor を起動せずに、設定ファイルの検証（Requirement 2）、Scene 存在チェック（Requirement 5）、公式 Unity CLI の検出（Requirement 4 AC 7）と Unity Hub/Editor の検出・バージョン一致確認（Requirement 4）のみを実行し、結果を表示して終了する
3. When `init` サブコマンドが実行された, the unity-render-core CLI shall 設定項目一式を含む設定ファイルの雛形（JSON）を生成する
4. The unity-render-core CLI shall `bun build --compile` により Windows 向け単一実行ファイル（.exe）としてビルド・配布できる（see D-3）

## Dig Summary

- ラウンド数: 2 / 質問数: 6 / 決定数: 6（＋派生決定 1）

### 主要な発見

1. **Editor は Scene ごとに再起動する（D-1）** — 推奨（1 起動連続処理）に対しユーザーは品質優先で再起動を選択。バッチ速度より状態汚染の構造的排除を優先する。これに伴い manifest バックアップ／復元はバッチ単位（開始時 1 回・終了時 1 回）に整理した
2. **出力は MP4 + MOV(ProRes) の 2 形式（D-2）** — 配信用と編集用中間コーデックを初期リリースから提供。Spec 2（音声 mux）の検証対象も 2 コンテナになる点は design へ引き継ぐ
3. **失敗時の不完全出力は自動削除、デバッグモード時のみ保持（D-6）** — 「出力先にファイルがある＝成功」の不変条件を確立

### 決定一覧

「Open Questions and Decisions (Dig)」の表を参照（D-1〜D-6）。

### 残存リスク（design フェーズへの引き継ぎ）

- `unity command eval` に渡せる C# のサイズ・複雑さの制約と書き出し完了検知方式は未確定のまま（意図的）。検証スパイク（Requirement 1）の実測結果を design に反映する
- D-5 の動的タイムアウト算出式（係数・マージン）は検証スパイクの実測で調整する
- Unity CLI（`com.unity.pipeline`）は experimental であり、破壊的変更リスクは恒常的に残る（per plan G-14）

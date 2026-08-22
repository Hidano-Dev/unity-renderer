# Implementation Plan — unity-render-core

> **実装ゲート（NO-GO 規則）**: タスク 2（検証スパイク）が完了し、`spike/README.md` に GO 判定とユーザー承認が記録されるまで、**タスク 3 以降のすべての実装タスクに着手してはならない**。スパイクで書き出し不成立（NO-GO）と判明した場合は後続タスクへ進まず、代替方針の再要件化をユーザーに提示する（Requirement 1.3、design「Research Needed / スパイク依存の暫定決定」参照）。
>
> **トレース規約**: 本ファイルの `_Requirements:_` は requirements.md の数値 ID `N.M` を用いる。コード・テスト内の trace タグ（`@impl` / spec タグ）では接頭辞付きの `URC-N.M`（例: `URC-6.4`）を用いる（design M-2）。

- [ ] 1. スパイク実施に必要な最小限の開発基盤を構築する
  - pnpm への依存追加（commander / zod / vitest / Biome ほか）と Bun ツールチェーンのセットアップを行い、pnpm と Bun の役割分担（依存解決は pnpm、ビルド・実行は Bun）を package.json の scripts に反映する
  - TypeScript strict 設定（`noUncheckedIndexedAccess` 含む）、Biome、vitest（`@hidano/artgraph/vitest` trace runner 組込み）の各設定を作成する
  - `.gitignore` に `dist/`・`*.exe`・vitest / artgraph trace の生成物を追加する
  - 完了条件: `pnpm install` 後に typecheck / lint / vitest（空スイート）がすべて成功し、リポジトリの `git status` に生成物が現れない
  - _Requirements: 15.4_
  - Files: package.json, tsconfig.json, biome.json, vitest.config.ts, .gitignore

- [ ] 2. 検証スパイクを実施し実装ゲートを通過する（GO/NO-GO 判定）
- [ ] 2.1 スパイク計画文書と検証環境を準備する
  - `spike/README.md` に検証項目 P-1〜P-13 の全一覧・各項目の確認内容・成功基準・失敗基準を design から転記・具体化して記録する
  - 実測に使う Unity 6 のテスト用プロジェクト（Timeline + PlayableDirector を含む最小 Scene 構成）を準備し、その所在と前提条件（`unity auth login` 済み等）を文書に記録する
  - 完了条件: `spike/README.md` に P-1〜P-13 の全項目が成功/失敗基準付きで列挙され、実測手順が第三者が再現できる粒度で書かれている
  - _Requirements: 1.1, 1.2_
  - Files: spike/README.md

- [ ] 2.2 Unity CLI eval 経路の成立性を実測する
  - `unity open` による GUI 起動と localhost:7800 への接続、`eval` / `eval_file` の実際の受け付け形態・HTTP リクエスト形式・エラー応答形式を実測する（P-1）
  - eval に渡せる C# のサイズ・複雑さの制約と、長い処理の分割・送信方法を確認する（P-1）
  - Play Mode 突入・ドメインリロード中の HTTP API の応答性と、ステータスファイル方式による完了検知の成立性（atomic write 可否・強制終了時の残留状態を含む）を確認する（P-2）
  - ポート 7800 の構成可否と衝突時の Editor / CLI の挙動、既存 Editor による占有の識別方法を確認する（P-5）。`unity editors -i` の実出力をフィクスチャとして採取する（P-8）
  - 完了条件: P-1 / P-2 / P-5 / P-8 の実測ログと成否が `spike/README.md` に記録されている
  - _Requirements: 1.1, 1.2_
  - Files: spike/README.md

- [ ] 2.3 Recorder 駆動と映像書き出しの成立性を実測する
  - eval 経由でのメモリ上 RecorderTrack / RecorderClip / MovieRecorderSettings 構築と、ドメインリロードを跨いだ各オブジェクトの生存状態を個別に確認する（P-7）。不成立時は Play Mode 突入後の再適用（2 段ペイロード構成）の成立性まで確認する
  - MP4 + MOV(ProRes) の 1 パス同時収録の安定性と Windows での ProRes エンコーダ利用可否・出力ファイル完成条件を確認する（P-3 / P-10）
  - `AsyncGPUReadback.WaitAllRequests()` 同期化の外部（eval）からの設定可否と具体的手段・呼び出し位置・負荷を確認する（P-4）
  - `com.unity.recorder` / `com.unity.pipeline` のピン止めバージョンを実動作で選定し（P-9）、`EditorApplication.Exit(0)` による保存ダイアログ非経由の終了可否を確認する（P-11）
  - Editor 起動・パッケージ import・ドメインリロード・エンコード時間を個別計測し、動的タイムアウトの係数・マージンの妥当性を確認する（P-6）
  - 完了条件: P-3 / P-4 / P-6 / P-7 / P-9 / P-10 / P-11 の実測ログと成否が `spike/README.md` に記録されている
  - _Requirements: 1.1, 1.2_
  - Files: spike/README.md

- [ ] 2.4 GO/NO-GO を判定しユーザー承認を得て設計へ反映する
  - 残項目（P-12: 復元書き戻しの atomicity、P-13: フック地点での出力確定と Editor 接続維持の両立）を机上検証＋実測で確認し記録する
  - P-1〜P-13 の確定結果（採用/フォールバック採用/不成立）を `spike/README.md` に総括し、GO/NO-GO 判定を明記する
  - 判定結果をユーザーに報告して承認を求め、承認状態を `spike/README.md` に記録する。**承認完了までタスク 3 以降には着手しない**。NO-GO の場合は後続実装へ進まず、代替方針の再要件化（requirements.md 更新）を提示する
  - 確定した暫定決定（eval トランスポート方式・完了検知方式・タイムアウト係数・ピン止めバージョン等）を design.md の該当セクションへ反映する
  - 完了条件: `spike/README.md` に全 P 項目の確定結果・GO 判定・ユーザー承認状態が記録され、design.md が実測結果と整合している
  - _Requirements: 1.1, 1.2, 1.3_
  - Files: spike/README.md, .kiro/specs/unity-render-core/design.md

- [ ] 3. 共通基盤と設定レイヤを実装する
- [ ] 3.1 共通基盤（Result 型・ロガー・ツール専有ディレクトリ解決）を実装する
  - 全レイヤ共通の Result 型・エラー分類・JsonValue 型を定義する
  - 通常/デバッグの 2 モードロガーを実装し、デバッグ無効時に詳細ログが出力へ混在しないことを保証する
  - `%LOCALAPPDATA%` 配下のツール専有ディレクトリ（セッション保管場所）の解決を実装する
  - 完了条件: 単体テストで 2 モードロガーの出力分離とパス解決が検証されている
  - _Requirements: 13.2, 13.3_
  - Files: src/shared/types.ts, src/shared/logger.ts, src/shared/paths.ts, tests/shared/logger.test.ts, tests/shared/paths.test.ts

- [ ] 3.2 設定スキーマと検証エラーを実装する
  - 設定 JSON の全項目（プロジェクト指定・Scene 名一覧・書き出し範囲・解像度・フレームレート・出力フォーマット 2 形式・出力先/ファイル名・デバッグフラグ・タイムアウト上書き）を zod スキーマとして定義する
  - 必須項目欠落・型不正・不正値を項目パス付きエラーとして検出し、Unity 関連処理を一切開始する前に失敗させる
  - 解像度・フレームレートは設定側で必須とし、Timeline 側設定に依存しない出力の前提を型で保証する。プリセット管理は提供しない
  - 完了条件: 欠落・型不正・値域違反の各ケースで該当項目を特定できるエラーが返ることが単体テストで検証されている
  - _Requirements: 2.1, 2.3, 2.4, 2.5_
  - Files: src/config/schema.ts, tests/config/schema.test.ts

- [ ] 3.3 設定読み込み・既定値適用・動的タイムアウト算出・雛形生成を実装する
  - 設定ファイルの読み込み・検証・既定値適用（イン/アウト点未指定時は Timeline 全長扱い）を実装する
  - 動的書き出しタイムアウト算出（実長 × 係数 + 固定マージン。スパイク 2.4 で確定した値）と、Editor 起動・終了の固定既定値、設定による上書きを実装する
  - `init` 用の設定雛形 JSON を生成し、雛形自身がスキーマ検証を通ることを保証する
  - 完了条件: タイムアウト算出式・雛形の自己検証・既定値適用が単体テストで検証されている
  - _Requirements: 2.1, 2.2, 10.6, 15.3_
  - Files: src/config/load.ts, src/config/template.ts, tests/config/load.test.ts, tests/config/template.test.ts

- [ ] 4. Unity 環境検出とバージョン一致確認を実装する
- [ ] 4.1 (P) Unity CLI 検出・Editor 列挙・プロジェクトバージョン解析を実装する
  - `unity` コマンドの存在・実行可否確認と、不在時のセットアップ手順参照付きエラーを実装する
  - `unity editors -i` 出力の寛容な行パーサを実装し、スパイクで採取した実出力フィクスチャでテストを固定する
  - `ProjectSettings/ProjectVersion.txt` の解析と Unity 6.0 未満の非対応エラーを実装する
  - 完了条件: フィクスチャベースの単体テストで CLI 不在・パース成功/失敗・6.0 未満判定の各経路が検証されている
  - _Requirements: 4.1, 4.2, 4.6, 4.7, 4.8_
  - _Depends: 3.1_
  - _Boundary: unity-env_
  - Files: src/unity-env/unity-cli.ts, src/unity-env/editors.ts, src/unity-env/project-version.ts, tests/unity-env/unity-cli.test.ts, tests/unity-env/editors.test.ts, tests/unity-env/project-version.test.ts

- [ ] 4.2 バージョン一致確認と unity install 誘導フローを実装する
  - 要求バージョンと一致する Editor の探索と、不一致時の「インストール実行 or 中断」の対話確認を実装する
  - インストール成功時は継続、中断選択・インストール失敗時はプロジェクト無変更のまま失敗終了する
  - 非対話環境（stdin が TTY でない）では自動的に中断を選択して失敗終了する
  - 完了条件: 対話/非対話・成功/失敗/中断の各分岐が単体テストで検証され、いずれの経路でも対象プロジェクトへ書き込みが発生しない
  - _Requirements: 4.3, 4.4, 4.5, 4.9_
  - Files: src/unity-env/install.ts, tests/unity-env/install.test.ts

- [ ] 5. プロジェクト非介入ガード（バックアップ・復元・復旧・ロック・Scene 解決）を実装する
- [ ] 5.1 (P) manifest バックアップとパッケージ一時追加を実装する
  - `manifest.json` / `packages-lock.json` をツール専有ディレクトリへバックアップし、コピーのバイト一致検証後にのみ一時追加へ進む。バックアップ失敗時は一時追加を行わず失敗終了する
  - セッションメタデータ（session.json）の atomic write（temp → rename）と、`packages-lock.json` 不在プロジェクトの「不在」記録を実装する
  - `com.unity.recorder`（未導入時のみ）と `com.unity.pipeline` の一時追加を、スパイクで確定したピン止めバージョンで実装する
  - 完了条件: 一時ディレクトリ上の単体テストでバックアップ→検証→一時追加の順序保証と失敗時 fail-fast が検証されている
  - _Requirements: 6.1, 6.2, 6.6_
  - _Depends: 3.1_
  - _Boundary: project-guard_
  - Files: src/project-guard/backup.ts, src/project-guard/manifest-patch.ts, tests/project-guard/backup.test.ts, tests/project-guard/manifest-patch.test.ts

- [ ] 5.2 復元・クラッシュ復旧・多重起動ガードを実装する
  - バッチ終了時の復元（バックアップからの書き戻し + セッション状態更新 + クリーンアップ）を実装し、復元後に manifest 群がバックアップとバイト一致することを保証する
  - 起動時のバックアップ残骸（active セッション）検出・ユーザー通知・復元実行と、復元失敗時の手動復旧手順提示を実装する
  - active セッション既存時の多重実行エラー停止を実装する
  - 完了条件: 「バックアップ→改変→復元でバイト一致」「packages-lock 不在時の削除による原状回復」「active 検出→復旧」の各シナリオが単体テストで検証されている
  - _Requirements: 6.3, 6.4, 6.5_
  - Files: src/project-guard/recovery.ts, src/project-guard/backup.ts, tests/project-guard/recovery.test.ts

- [ ] 5.3 (P) プロジェクトロック競合検出を実装する
  - `Temp/UnityLockfile` の排他モードオープン試行により、別 Editor による使用中とクラッシュ残骸（stale lockfile）を判別する
  - 競合時は対象プロジェクトを閉じるよう促すエラーメッセージで失敗終了する
  - 完了条件: 「使用中（共有違反）」「不在」「残骸（排他成功）」の 3 経路が単体テストで検証されている
  - _Requirements: 7.5_
  - _Boundary: project-guard/lock_
  - Files: src/project-guard/lock.ts, tests/project-guard/lock.test.ts

- [ ] 5.4 (P) Scene 名解決を実装する
  - Scene 名（パス不可）を `Assets/` 配下の `.unity` ファイルへ大文字小文字区別で解決する（`Packages/` は対象外）
  - 全 Scene 名の一括チェックで、不足時は不足一覧・重複時は候補パス一覧を提示して即エラー停止する
  - 完了条件: 解決成功・不足・同名重複・大文字小文字・Packages 除外の各ケースが単体テストで検証されている
  - _Requirements: 5.1, 5.2, 5.3, 5.4_
  - _Boundary: project-guard/scene-resolver_
  - Files: src/project-guard/scene-resolver.ts, tests/project-guard/scene-resolver.test.ts

- [ ] 6. eval 用 C# ペイロード群を実装する
- [ ] 6.1 テンプレート管理とパラメータ注入機構を実装する
  - C# コードを独立テンプレートファイルとして管理し、ビルド時に文字列アセットとして実行ファイルへ埋め込む機構を実装する
  - プレースホルダへの JSON 埋め込みによる単一方式のパラメータ注入を実装する（文字列連結による C# 組み立ては行わない）
  - 完了条件: 引用符・バックスラッシュ・改行・非 ASCII を含む Windows パスの注入がエスケープ事故なく行われることが単体テストで検証されている
  - _Requirements: 8.1, 9.1, 10.1, 11.1_
  - Files: src/csharp-payloads/compile.ts, tests/csharp-payloads/compile.test.ts

- [ ] 6.2 (P) Scene オープンと PlayableDirector 検出ペイロードを実装する
  - 保存確認なしモードでの Scene オープンと、ルート階層からの PlayableDirector 検出（入れ子は対象外）を実装する
  - 複数検出時は警告情報付きで先頭を選択、0 件時はエラー応答を返す。Timeline 全長・実効フレームレートを応答に含める
  - 完了条件: パラメータ注入済み出力の固定スナップショットテストと必須 API 呼び出し列の検証が通る
  - _Requirements: 8.1, 8.2, 8.3, 8.4_
  - _Depends: 6.1_
  - _Boundary: csharp-payloads/open-scene_
  - Files: src/csharp-payloads/templates/open-scene.cs, tests/csharp-payloads/open-scene.test.ts

- [ ] 6.3 (P) メモリ上 Recorder 構成ペイロードを実装する
  - RecorderTrack / RecorderClip / MovieRecorderSettings をメモリ上のみで構築し（DontSave・AssetDatabase 非登録）、アセットとして保存しない
  - 設定された解像度・出力フォーマット（スパイクで確定した同時収録 or 逐次方式）・確定済み出力パスを適用し、Timeline 実効フレームレートを一時上書きし、イン/アウト点を記録範囲に設定する
  - AsyncGPUReadback 同期化をスパイクで確定した手段で常時有効化し、音声収録を無効化する
  - 完了条件: スナップショットテストと必須 API 呼び出し列（DontSave・audio capture 無効化等）の検証が通る
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_
  - _Depends: 6.1_
  - _Boundary: csharp-payloads/setup-recorder_
  - Files: src/csharp-payloads/templates/setup-recorder.cs, tests/csharp-payloads/setup-recorder.test.ts

- [ ] 6.4 (P) 書き出し開始と未保存終了ペイロードを実装する
  - Play Mode 突入・再生開始と、書き出し進行・完了・失敗をステータス JSON へ逐次書き込む監視コールバック（スパイクで確定した atomic write 仕様・ドメインリロード対応）を実装する
  - シーン・アセットを一切保存せず Editor を終了させるペイロードを実装する
  - 完了条件: スナップショットテストと必須 API 呼び出し列（保存なし終了等）の検証が通る
  - _Requirements: 10.1, 10.2, 11.1_
  - _Depends: 6.1_
  - _Boundary: csharp-payloads/start-recording, csharp-payloads/quit-editor_
  - Files: src/csharp-payloads/templates/start-recording.cs, src/csharp-payloads/templates/quit-editor.cs, tests/csharp-payloads/start-recording.test.ts, tests/csharp-payloads/quit-editor.test.ts

- [ ] 7. Editor セッション管理を実装する
- [ ] 7.1 Editor の GUI 起動・接続確立・強制終了を実装する
  - `unity open` による GUI モード起動（batchmode / nographics 不使用）と PID 追跡・冪等な強制終了を実装する
  - 起動前のポート 7800 使用チェック（使用中は Editor を起動せず即失敗）と、起動後の接続待ちポーリング・接続タイムアウト時のプロセス終了 + 手掛かり付きエラーを実装する
  - 完了条件: 接続成功・接続タイムアウト→強制終了・ポート競合の各経路が単体テストで検証されている
  - _Requirements: 7.1, 7.2, 7.3_
  - Files: src/editor-session/session.ts, tests/editor-session/session.test.ts

- [ ] 7.2 eval トランスポート（pipeline クライアント）を実装する
  - スパイクで確定した送信方式（一時ファイル + eval_file を第一候補、不成立時は分割 inline）による eval 送信を実装する
  - 接続レベル失敗のみの限定再試行、送信失敗と C# 実行失敗のエラー分類、一時ファイルの finally 削除（デバッグ時保持）を実装する
  - デバッグモード時のペイロード ID・サイズ・HTTP 応答の時系列ログを実装する
  - 完了条件: エラー分類・再試行上限・一時ファイル削除の各経路（成功・失敗・デバッグ保持）が単体テストで検証されている
  - _Requirements: 7.2, 13.2_
  - Files: src/editor-session/pipeline-client.ts, tests/editor-session/pipeline-client.test.ts

- [ ] 7.3 ステータスチャネルによる完了検知を実装する
  - ステータス JSON ファイルのポーリング読み取りによる書き出し完了・失敗の検知（スパイクで確定した状態遷移・古いステータス識別・更新停滞時の打ち切り）を実装する
  - 書き込み途中の JSON は「変化なし」としてスキップし次ポーリングへ進む
  - 完了条件: completed / failed / タイムアウト / 部分書き込みスキップの各経路が単体テストで検証されている
  - _Requirements: 10.2_
  - Files: src/editor-session/status-channel.ts, tests/editor-session/status-channel.test.ts

- [ ] 7.4 Editor の未保存終了とタイムアウト時の強制終了を実装する
  - 終了ペイロード送信による未保存終了要求と、規定時間内に終了しない場合の強制終了フォールバックを実装する
  - 終了完了後にプロセスが存在しないこと（terminated 状態）を保証する
  - 完了条件: 正常終了・終了ブロック→強制終了の両経路が単体テストで検証されている
  - _Requirements: 11.1, 11.2_
  - Files: src/editor-session/session.ts, tests/editor-session/session.test.ts

- [ ] 8. バッチ実行・出力管理・フック・進捗表示を実装する
- [ ] 8.1 (P) 出力ファイル名ワイルドカード展開と出力管理を実装する
  - Recorder 準拠のワイルドカード一式（`<Scene>` `<Take>` `<Recorder>` 等）の展開規則と、未知ワイルドカードの Preflight 検証エラーを実装する
  - `<Take>` の既存ファイル走査による採番と、2 形式出力時のファイル名衝突検証を実装する
  - 出力ファイルの存在・サイズ検証と、失敗時の不完全出力の自動削除（デバッグモード時は保持）を実装する
  - 完了条件: 全ワイルドカードの展開・採番・衝突検証・削除/保持の各規則が単体テストで検証されている
  - _Requirements: 3.1, 3.2, 10.3, 10.7_
  - _Depends: 3.3_
  - _Boundary: batch/output_
  - Files: src/batch/output.ts, tests/batch/output.test.ts

- [ ] 8.2 (P) フック登録と Handoff 契約を実装する
  - 「書き出し完了後・Editor 終了前」のフック地点の in-process 登録 API と登録順の直列実行を実装する
  - 後続処理へ受け渡す情報（映像絶対パス・実効フレームレート・イン/アウト点）の契約型と、フック用コンテクスト（追加 eval 実行・受け渡し用ディレクトリ）を実装する
  - フック未登録時のスキップと、フック失敗の記録（後続フックのスキップを含む）を実装する
  - 完了条件: 登録順実行・未登録スキップ・失敗記録の各経路が単体テストで検証されている
  - _Requirements: 14.1, 14.2, 14.3, 14.4_
  - _Depends: 7.2_
  - _Boundary: hooks_
  - Files: src/hooks/registry.ts, tests/hooks/registry.test.ts

- [ ] 8.3 (P) 進捗表示と終了コード変換を実装する
  - 既定表示（実行中 Scene・成否・所要時間・エクスプローラーで開くリンク）と、TTY 判定による OSC 8 リンク/プレーンパスの切替を実装する
  - デバッグモード時のみ Unity ログを出力に含め、無効時は詳細ログを混在させない
  - バッチ結果から終了コード（0 / 2 / 3）への変換を実装する
  - 完了条件: 表示内容・TTY 切替・終了コード変換の各規則が単体テストで検証されている
  - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_
  - _Depends: 3.1_
  - _Boundary: reporting_
  - Files: src/reporting/progress.ts, src/reporting/exit-code.ts, tests/reporting/progress.test.ts, tests/reporting/exit-code.test.ts

- [ ] 8.4 1 Scene ジョブフローを実装する
  - 状態遷移（起動→接続→Scene オープン→Recorder 構成→書き出し→検証→フック→終了）を実装し、Director 不在・接続不能・書き出し失敗・タイムアウトのあらゆる失敗経路を「不完全出力の削除（デバッグ時除く）→ Editor 確実終了 → 失敗記録」に収束させる
  - 書き出しタイムアウト超過時のハングした Editor プロセスの強制終了と、範囲未指定時の Timeline 全長によるタイムアウト確定（Scene オープン応答後）を実装する
  - 書き出し成功時のみフックを発火し、フック失敗時も未保存終了を必ず実行する
  - 完了条件: フェイク EditorSession を用いた結合テストで、全失敗経路が状態遷移図どおり収束することが検証されている
  - _Requirements: 8.4, 10.1, 10.2, 10.3, 10.4, 10.5, 10.7, 11.1, 11.2, 14.1, 14.3, 14.4_
  - _Depends: 6.2, 6.3, 6.4, 7.4, 8.1, 8.2_
  - Files: src/batch/scene-job.ts, tests/batch/scene-job.test.ts

- [ ] 8.5 直列バッチランナーを実装する
  - 複数 Scene を直列キューで 1 Scene ずつ処理し、Scene ごとに Editor プロセスを再起動する（前 Scene の Editor 終了 → 新規起動）
  - Scene 失敗時もバッチを中断せず記録して継続し、全 Scene 終了後に成否一覧を確定してから終了処理へ進む
  - Scene 間・タイムアウト時もパッケージ一時追加状態を維持し、復元はバッチ終了時に 1 回だけ実行されることを保証する
  - 完了条件: 3 Scene 中 1 失敗の継続・結果集約・Editor 再起動・一時追加状態維持が結合テストで検証されている
  - _Requirements: 6.3, 10.5, 12.1, 12.2, 12.3, 12.4_
  - Files: src/batch/runner.ts, tests/batch/runner.test.ts

- [ ] 9. CLI サブコマンドを統合する
- [ ] 9.1 render サブコマンドと合成ルートを実装する
  - クラッシュ復旧 → Preflight（設定検証 → 環境検出 → Scene 解決 → ロック確認）→ バックアップ/一時追加 → バッチ実行 → 復元（finally 保証）→ 終了コードの全体フローを組み立てる
  - Preflight エラーは終了コード 1、Scene 失敗は 2、復元失敗は 3（手動復旧手順提示付き）で終了する
  - 完了条件: `render` コマンドが全レイヤを結線して実行でき、各エラー種別と終了コードの対応が結合テストで検証されている
  - _Requirements: 6.4, 13.4, 13.5, 15.1_
  - Files: src/cli/index.ts, src/cli/render.ts, tests/cli/render.test.ts

- [ ] 9.2 check / init サブコマンドを実装する
  - `check`: Editor を起動せずに設定検証・Scene 存在チェック・Unity CLI 検出・Editor 検出/バージョン一致確認のみを実行し結果を表示する（クラッシュ復旧を除きプロジェクト無変更）
  - `init`: 設定項目一式を含む雛形 JSON をカレントディレクトリへ生成する（既存ファイルは上書きせずエラー）
  - 完了条件: `check` が Editor 非起動・プロジェクト無変更であること、`init` の生成物がスキーマ検証を通ることが結合テストで検証されている
  - _Requirements: 15.1, 15.2, 15.3_
  - Files: src/cli/check.ts, src/cli/init.ts, tests/cli/check.test.ts, tests/cli/init.test.ts

- [ ] 10. 結合検証と実機 E2E を実施する
- [ ] 10.1 フェイクを用いた結合テスト一式を整備する
  - フェイク HTTP サーバ（7800 模擬）による接続待ちリトライ・eval 応答・接続タイムアウト→強制終了経路の検証を実装する
  - status-channel の completed / failed / タイムアウト 3 経路と部分書き込みスキップの結合検証を実装する
  - `check` のプロジェクト無変更検証（クラッシュ復旧を除く）を実装する
  - 完了条件: 結合テストスイートが CI 相当のコマンド一発で全件成功する
  - _Requirements: 7.2, 7.3, 10.2, 15.2_
  - Files: tests/integration/editor-session.test.ts, tests/integration/status-channel.test.ts, tests/integration/cli-check.test.ts

- [ ] 10.2 実 Unity プロジェクトでの E2E 手動シナリオを実施する
  - 2 Scene バッチ（MP4 + MOV(ProRes)）の実行と成否一覧・出力ファイルの実測確認を行う
  - 実行前後で対象プロジェクトの `git status` がクリーンであること（`Library/` 等は対象外）を確認する
  - Editor 強制終了（クラッシュ模擬）後の次回起動でのバックアップ残骸検出・通知・復元を確認する
  - 完了条件: 手動シナリオの手順・実測結果・確認日時がチェックリスト文書に記録されている
  - _Requirements: 6.4, 6.5, 10.3, 12.3, 12.4_
  - Files: docs/e2e-checklist.md

- [ ] 11. ドキュメントと配布物を整備する
- [ ] 11.1 (P) 初回セットアップドキュメントを作成する
  - Unity アカウント認証（`unity auth login`）を含む初回セットアップ手順を記載する
  - Unity CLI（`com.unity.pipeline`）が experimental であり破壊的変更のリスクがあることを明記する
  - 公式 Unity CLI が未検出の場合のエラーメッセージから参照されるインストール手順を記載する
  - 完了条件: セットアップ手順書が存在し、認証手順と experimental リスクの記述を含む
  - _Requirements: 1.4, 4.8, 7.4_
  - _Boundary: docs_
  - Files: docs/setup.md

- [ ] 11.2 (P) 単一実行ファイルの配布ビルドと CI を整備する
  - `bun build --compile` による Windows 向け単一 .exe のビルドスクリプトを整備し、生成物のスモークテスト（`init` → `check` が exe 単体で動作）を行う
  - C# テンプレートが .exe に埋め込まれ、外部ファイルなしで動作することを確認する
  - GitHub Actions（windows-latest）で typecheck / lint / vitest / artgraph gate を実行する CI を整備する
  - 完了条件: 生成された .exe が Node/Bun 未インストール前提で `init` / `check` を実行でき、CI が green である
  - _Requirements: 15.4_
  - _Boundary: cli, CI_
  - Files: package.json, .github/workflows/ci.yml

## Requirements Coverage

| Requirement | Tasks |
|---|---|
| 1.1–1.3 | 2.1, 2.2, 2.3, 2.4 |
| 1.4 | 11.1 |
| 2.1–2.5 | 3.2, 3.3 |
| 3.1–3.2 | 8.1 |
| 4.1–4.9 | 4.1, 4.2, 11.1 |
| 5.1–5.4 | 5.4 |
| 6.1–6.6 | 5.1, 5.2, 8.5, 9.1, 10.2 |
| 7.1–7.5 | 5.3, 7.1, 7.2, 10.1, 11.1 |
| 8.1–8.4 | 6.2, 8.4 |
| 9.1–9.6 | 6.3 |
| 10.1–10.7 | 3.3, 6.4, 7.3, 8.1, 8.4, 8.5, 10.1, 10.2 |
| 11.1–11.2 | 6.4, 7.4, 8.4 |
| 12.1–12.4 | 8.5, 10.2 |
| 13.1–13.5 | 3.1, 8.3, 9.1 |
| 14.1–14.4 | 8.2, 8.4 |
| 15.1–15.4 | 1, 3.3, 9.1, 9.2, 10.1, 11.2 |

# Implementation Plan — timeline-audio-remux

> **実装ゲート（NO-GO 規則）— 2026-08-23 通過済み**: タスク 1 の検証スパイクは完了し、`spike/timeline-audio/README.md` に Q-1〜Q-11 の実測ログ・**GO 判定・ユーザー承認**が記録された。タスク 2 以降の実装に着手してよい。確定値は design.md の該当節へ反映済み（JSON 生成方式・API マッピング表・FfmpegManifest・pitchMode・ミックス方式・同期精度の判定基準）。以下は当初のゲート条件（記録として残す）: Q-1〜Q-6（抽出成立性）のいずれかが不成立、または Q-11（ミックス同等性）が design 確定に至らない場合は後続タスクへ進まず、代替方針の再検討をユーザーに提示する（Requirement 12.3、design「Research Needed / スパイク依存の暫定決定」参照）。
>
> **クロススペック依存（unity-render-core）**: 本 Spec は unity-render-core と同一コードベース・同一 .exe に組み込まれる。以下の core 側成果物を前提とするタスクには、各タスクの詳細に前提を明記する:
> - スパイク（タスク 1）: core の検証スパイク環境（実 Unity 6 テストプロジェクト + eval 送信経路。core tasks 2.1–2.2 の P-1 成立、または最小同等の eval 経路）
> - C# パラメータ注入・ツール管理ディレクトリ（タスク 4.1）: core の `csharp-payloads`（core task 6.1）と `shared/paths`（core task 3.1）
> - フック統合（タスク 4.3, 5.x）: core の `RenderHooks` / `HookContext` / `RenderHandoff` 契約と合成ルート（core tasks 8.2, 8.4, 9.1）
>
> **トレース規約**: 本ファイルの `_Requirements:_` は requirements.md の数値 ID `N.M` を用いる。コード・テスト内の trace タグ（`@impl` / spec タグ）では接頭辞付きの `TAR-N.M`（例: `TAR-7.2`）を用いる（design Traceability 節）。

- [x] 1. Timeline 固有の検証スパイクを実施し実装ゲートを通過する（GO/NO-GO 判定）
- [x] 1.1 スパイク計画文書と検証用 Timeline 構成を準備する
  - `spike/timeline-audio/README.md` に検証項目 Q-1〜Q-11 の全一覧・各項目の確認内容・成功基準・失敗基準を design から転記・具体化して記録する
  - core スパイク用の実 Unity 6 テストプロジェクトに、検証に必要な Timeline 構成（2 段以上のネスト・GroupTrack 配下の AudioTrack・変速クリップ・ループクリップ・ミュートトラック・ControlClip timeScale・参照切れ ControlClip・複数音源の重なり）を追加し、所在と前提条件を文書に記録する
  - 前提: core の eval 送信経路（core P-1）が成立していること。未成立の場合は本タスクを開始しない
  - 完了条件: `spike/timeline-audio/README.md` に Q-1〜Q-11 の全項目が成功/失敗基準付きで列挙され、実測手順が第三者が再現できる粒度で書かれている
  - _Requirements: 12.1, 12.2_
  - Files: spike/timeline-audio/README.md

- [x] 1.2 抽出成立性（Q-1〜Q-6）を実測する
  - eval 実行 C# からの全階層 AudioTrack 列挙（多段ネストの ControlPlayableAsset ExposedReference 解決・GroupTrack 配下・参照切れ時の挙動）を実測する（Q-1）
  - TimelineClip / AudioPlayableAsset の属性一式（start / duration / clipIn / timeScale / clip / loop）の実値と Editor UI 表示の一致、クリップ長 > 音源長時のループ実挙動を確認する（Q-2）
  - クリップ音量・トラック音量・階層ミュートの取得経路（公開 API の有無、`SerializedObject` fallback の成立性）を確定する（Q-3 / Q-4）
  - `AssetDatabase.GetAssetPath` による元ファイル絶対パス解決（.wav/.mp3/.ogg・サブアセット判定・Packages 内アセット）を確認する（Q-5）
  - JsonUtility + double DTO での JSON 生成・sessionDir への atomic write（temp → rename）・大規模 Timeline（100+ クリップ）での eval 実行時間とサイズ制約を確認する（Q-6）
  - 完了条件: Q-1〜Q-6 の実測ログと成否（採用 API / fallback 採用 / 不成立）が `spike/timeline-audio/README.md` に記録されている
  - _Requirements: 12.1, 12.2_
  - Files: spike/timeline-audio/README.md

- [x] 1.3 ffmpeg 側の暫定決定（Q-7〜Q-9）を実測し確定する
  - 変速再生（クリップ速度 2.0 / 0.5・ControlClip timeScale）時の Unity Editor 実再生音のピッチ変動有無を実測し、`pitchMode` 既定値（resample / preserve-pitch）を確定する（Q-7）
  - BtbN FFmpeg-Builds の具体タグ・URL・SHA-256 を確定し、同ビルドでの必要フィルタ（amix / adelay サンプル指定 / atrim / asetrate / atempo / aresample / aformat / apad / volume）と native AAC / pcm_s24le の動作、LICENSE.txt 同梱内容とライセンス義務を確認する（Q-8）
  - 実 Recorder 出力の MP4 / MOV(ProRes) への `-c:v copy` + コーデックマトリクスでの mux 成立、ストリーム長差の実測（7.4 の許容誤差検証）、mux 所要時間（タイムアウト式の係数調整）を確認する（Q-9）
  - 完了条件: Q-7〜Q-9 の実測ログと確定値（pitchMode 既定値・FfmpegManifest 定数・コーデックマトリクス・タイムアウト係数）が `spike/timeline-audio/README.md` に記録されている
  - _Requirements: 12.1, 12.2_
  - Files: spike/timeline-audio/README.md

- [x] 1.4 時間正規化とミックス同等性（Q-10 / Q-11）を実測し design 確定ゲートを検証する
  - ネスト 2 段 + timeScale 0.5/2.0 + ControlClip clipIn ありの構成で、実再生の発音タイミングと時間正規化ステップ 1–2 の算出値の一致、祖先可視窓クランプの実挙動を確認する（Q-10）
  - Unity Editor 上で複数音源（音量差・重なりあり）を同時再生した基準波形・ピーク値・クリッピング挙動を採取し、`amix=normalize=0` の ffmpeg 出力波形と比較して同等性を実測する。一致しない場合はゲイン計算またはミックス方式の再決定案を記録する（Q-11。design 確定の NO-GO ゲート）
  - 完了条件: Q-10 / Q-11 の実測ログ（波形・数値比較）と同等性の成否判定が `spike/timeline-audio/README.md` に記録されている
  - _Requirements: 12.1, 12.2_
  - Files: spike/timeline-audio/README.md

- [x] 1.5 GO/NO-GO を判定しユーザー承認を得て設計へ反映する
  - Q-1〜Q-11 の確定結果（採用 / フォールバック採用 / 不成立）を `spike/timeline-audio/README.md` に総括し、GO/NO-GO 判定を明記する
  - 判定結果をユーザーに報告して承認を求め、承認状態を `spike/timeline-audio/README.md` に記録する。**承認完了までタスク 2 以降には着手しない**。NO-GO（Q-1〜Q-6 の抽出不成立、または Q-11 の同等性未確定）の場合は後続実装へ進まず、代替方針の再検討をユーザーに提示する
  - 確定した暫定決定（API マッピング表の採用経路・pitchMode 既定値・FfmpegManifest・コーデックマトリクス・タイムアウト式・ミックス方式）を design.md の該当セクションへ反映する
  - 完了条件: `spike/timeline-audio/README.md` に全 Q 項目の確定結果・GO 判定・ユーザー承認状態が記録され、design.md が実測結果と整合している
  - _Requirements: 12.2, 12.3_
  - Files: spike/timeline-audio/README.md, .kiro/specs/timeline-audio-remux/design.md

- [x] 2. Unity 非依存の純 TS 基盤（メタデータ・時間計算）を実装する
- [x] 2.1 (P) 音声メタデータ JSON スキーマと検証・音源存在確認を実装する
  - 音声メタデータ JSON の zod スキーマ（schemaVersion・クリップ属性一式・errors / warnings）を本 Spec の責務として定義し、TypeScript 型をスキーマから導出する
  - 受領 JSON の検証順序（パース → スキーマ検証 → schemaVersion 一致 → errors 空確認 → 全クリップの音源ファイル存在確認）を実装し、不適合箇所（zod issue パス / 欠落ファイルパスとクリップ ID）を特定できるエラーを返す
  - 整合規則（有限値・rootStartSec ≥ 0・effectiveSpeed > 0）をスキーマで強制し、欠落音源を黙って除外した部分ミックスへ進めない構造にする
  - 完了条件: 正常系・欠落・型不正・範囲外・未知 schemaVersion・errors 非空・音源欠落の各フィクスチャ（スパイクで採取した実 JSON を含む）が単体テストで検証されている
  - _Requirements: 2.4, 3.1, 3.2, 3.3, 10.1_
  - _Boundary: metadata_
  - Files: src/audio-remux/metadata/schema.ts, src/audio-remux/metadata/load.ts, tests/audio-remux/metadata/schema.test.ts, tests/audio-remux/metadata/load.test.ts

- [x] 2.2 (P) 時間正規化の純関数群を実装する
  - 時間正規化の後半ステップ（clipIn 適用 → ループ折り返し → イン点頭出し → アウト点打ち切り）を Unity 非依存の純関数として実装する
  - イン点より前に開始し再生中のクリップの頭出し位置（ループ・変速を含む式）と、アウト点跨ぎクリップの打ち切り・出力配置遅延の算出を実装する
  - 境界挙動（速度 0・負・非有限のスキップ、空区間・音源長ゼロの通常除外、clipIn 負値のクランプ、非ループの音源末尾自然終端）を design の確定どおり実装する
  - adelay サンプル指定（48000 Hz 基準）による配置量子化誤差 ≤ 1 サンプルの前提を関数出力（非負整数サンプル値）で保証する
  - 完了条件: ネスト 0〜3 段 timeScale 累積 × クリップ速度 × clipIn × ループ × イン/アウトの組合せ表テストと境界挙動テストが全件成功する
  - _Requirements: 2.6, 7.1, 7.2, 7.3, 7.4_
  - _Boundary: planner/time-math_
  - Files: src/audio-remux/planner/time-math.ts, tests/audio-remux/planner/time-math.test.ts

- [x] 2.3 MixPlan（ffmpeg 配置計画）構築を実装する
  - 検証済みメタデータと RenderHandoff（イン/アウト点）から、配置済みクリップ一覧（トリム区間・速度・ゲイン・遅延サンプル・ループフラグ）を構築する
  - ミュートトラック上のクリップの除外と、ゲインのクリップ音量 × トラック音量への畳み込みを実装する
  - 採用クリップ ∪ スキップ（理由付き）∪ ミュート除外 = メタデータ全クリップとなる取りこぼしなしの変換を保証する
  - 完了条件: 純関数（同一入力で出力一致）として、除外・スキップ・全単射性・イン/アウト整合の各性質が単体テストで検証されている
  - _Requirements: 4.2, 4.3, 4.4, 4.5, 4.6, 7.1_
  - _Depends: 2.1, 2.2_
  - Files: src/audio-remux/planner/mix-plan.ts, tests/audio-remux/planner/mix-plan.test.ts

- [ ] 3. ffmpeg の取得・filter graph・実行・成果物確定を実装する
- [ ] 3.1 (P) ピン止めマニフェストと ffmpeg 取得マネージャを実装する
  - スパイク Q-8 で確定した buildId・URL・SHA-256・ライセンス情報をコード内定数（マニフェスト）として保持する
  - 取得フロー（一時ファイルへ DL → SHA-256 検証 → staging 展開 → smoke → buildId ディレクトリへ atomic rename → install-info.json 記録）と、ロックファイルによる取得の直列化・ロック残骸の PID 生存確認を実装する
  - 取得済み時のオフライン動作、破損検出時の削除 + 再ダウンロード 1 回、手動配置エスケープハッチ（manual ディレクトリの警告付き最優先使用）を実装する
  - 失敗時（オフライン・プロキシ・AV ブロック・権限不足・ハッシュ不一致）は原因切り分け情報と手動配置手順（取得元 URL + manual 配置先絶対パス）を含むエラーを返す
  - 完了条件: モック fetch + フェイク zip フィクスチャで成功経路・ハッシュ不一致・破損 zip・smoke 失敗・ロック競合（並行 2 プロセス相当）・ロック残骸・manual 優先の各経路が単体テストで検証されている
  - _Requirements: 5.1, 5.3, 5.4, 5.5, 5.6, 5.7_
  - _Boundary: ffmpeg/acquire_
  - Files: src/audio-remux/ffmpeg/manifest.ts, src/audio-remux/ffmpeg/acquire.ts, tests/audio-remux/ffmpeg/acquire.test.ts

- [ ] 3.2 (P) filter graph 構築とコーデックマトリクスを実装する
  - クリップごとのフィルタチェーン（トリム → 変速 → ステレオ/48kHz 正規化 → 音量 → サンプル指定遅延）と、amix によるミックス（スパイク Q-11 で確定した方式）・apad/atrim によるストリーム長確定を、決定的な filter script 文字列として生成する
  - 変速フィルタの両モード（resample / preserve-pitch）を実装し、既定値はスパイク Q-7 の確定値に従う。ループクリップには入力の無限繰り返し指定を付与する
  - コンテナ別コーデック引数（MP4 → AAC 48kHz、MOV(ProRes) → PCM 24bit。スパイク確定値）を設定項目なしの自動選択として実装する
  - filter script はコマンドライン長制限回避のためスクリプトファイル渡し前提の形式で出力する
  - 完了条件: 代表 MixPlan（単一 / 重なり / ループ / 変速両モード / モノラル正規化 / イン点跨ぎ）の filter script 固定スナップショットテストとコーデック引数のテーブルテストが全件成功する
  - _Requirements: 4.1, 4.2, 4.5, 4.6, 6.2, 6.4_
  - _Boundary: ffmpeg/filter-graph, ffmpeg/codec-matrix_
  - _Depends: 2.3_
  - Files: src/audio-remux/ffmpeg/filter-graph.ts, src/audio-remux/ffmpeg/codec-matrix.ts, tests/audio-remux/ffmpeg/filter-graph.test.ts, tests/audio-remux/ffmpeg/codec-matrix.test.ts

- [ ] 3.3 ffmpeg プロセス実行（mux ランナー）を実装する
  - 3.2 の FilterGraph 契約に依存するため (P) ではない（同グループ直前タスクへのデータ依存）
  - 管理ディレクトリ（または manual）の ffmpeg のみを引数配列 spawn で実行し、映像ストリームは常にコピー（再エンコードなし）で一時出力へ mux する
  - タイムアウト強制終了（スパイク Q-9 で確定した式）と、非 0 終了・起動失敗・出力不正のエラー分類（stderr 末尾抜粋付き）を実装する
  - デバッグモード時は実行コマンドライン全文と stderr 全文をデバッグログと sessionDir のログファイルへ出力し、無効時は詳細ログを進捗表示に混在させない
  - 完了条件: フェイク ffmpeg.exe（引数記録スクリプト）でコマンドライン組み立て（映像コピー・コーデック引数・スクリプトファイル渡し）・タイムアウト・デバッグログ収集の各経路が検証されている
  - _Requirements: 5.2, 6.1, 6.3, 6.5, 10.3, 11.1, 11.2_
  - _Depends: 3.2_
  - Files: src/audio-remux/ffmpeg/run.ts, tests/audio-remux/ffmpeg/run.test.ts

- [ ] 3.4 (P) 最終成果物の置き換え確定を実装する
  - mux 済み一時ファイルの検証（存在・サイズ > 0）後にのみ元の無音映像を置き換え、最終成果物のファイル名を core が確定した出力パスと完全一致させる（置き換え方式）
  - 検証完了まで元の無音映像に一切触れない手順により、失敗時の無音映像保全を構造的に保証する
  - デバッグモード時は無音版をバックアップ名で保持し、置き換え途中のクラッシュ残骸（一時ファイル）は次回実行時に警告付きで報告する
  - 出力単位で完結させ、一方の出力の失敗が確定済みの他方に影響しないようにする
  - 完了条件: 成功 / 検証失敗で無音版無傷 / デバッグ時バックアップ保持 / 残骸検出の全経路が単体テストで検証されている
  - _Requirements: 9.1, 9.2, 9.3, 10.4, 11.3_
  - _Boundary: output/finalize_
  - Files: src/audio-remux/output/finalize.ts, tests/audio-remux/output/finalize.test.ts

- [ ] 4. 音声情報抽出 C# ペイロードと抽出実行サービスを実装する
- [ ] 4.1 core 側共有ユーティリティの公開（パラメータ注入・ツール管理ディレクトリ）を実装する
  - 前提: core の `csharp-payloads`（core task 6.1）と `shared/paths`（core task 3.1）が実装済みであること
  - core のプレースホルダ注入ロジックを汎用関数として export する（core の閉じた PayloadId union は変更しない）
  - ツール管理ディレクトリ（sessions と別系統の tools 配下）の解決関数を core の paths へ追加する
  - いずれも既存契約のシェイプを変えない追加のみとし、core の既存テストが全件成功したままであることを確認する
  - 完了条件: 注入関数の export とツールディレクトリ解決が単体テストで検証され、core 既存テストに回帰がない
  - _Requirements: 5.7, 8.2_
  - Files: src/csharp-payloads/compile.ts, src/shared/paths.ts, tests/csharp-payloads/compile.test.ts, tests/shared/paths.test.ts

- [ ] 4.2 音声情報抽出 C# ペイロードを実装する
  - スパイク Q-1〜Q-6 で確定した API 経路に従い、ルート TimelineAsset からの AudioTrack 走査、ControlTrack の子 Timeline 再帰（多段ネスト・解決不能クリップの warning スキップ）を実装する
  - 各クリップの属性抽出（元ファイル絶対パス・clipIn・クリップ音量・再生速度・トラック音量/ミュート・ループ・音源長）と、祖先 ControlClip の累積によるルート基準絶対開始時刻・実効再生速度への換算（時間正規化ステップ 1–2・可視窓クランプ）を実装する
  - サブアセット等ファイル実体を持たない参照の error 記録、Scene 内 AudioSource を走査対象に含めない構造的保証（走査起点を TimelineAsset のトラック列挙に限定）を実装する
  - JSON を一時ファイル書き込み後 rename で atomic に出力し、eval 応答に成否と要約を返す。読み取り・抽出・sessionDir への書き込み以外を行わない（プロジェクト非介入）
  - 完了条件: パラメータ注入済み出力の固定スナップショットテストと必須 API 呼び出し列（トラック列挙・atomic write・JsonUtility・変更系 API 不使用）の文字列検証が通る
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 2.6, 8.4_
  - _Depends: 4.1_
  - Files: src/audio-remux/extract/templates/extract-audio.cs, src/audio-remux/extract/payload.ts, tests/audio-remux/extract/payload.test.ts

- [ ] 4.3 抽出実行サービス（TS 側）を実装する
  - 前提: core の `HookContext.evalCSharp`（core task 8.2）が実装済みであること
  - eval 実行による抽出 C# の送信と、書き込み完了判定（eval 応答成功 + JSON ファイル存在）を実装する
  - 抽出 eval のタイムアウト（スパイク実測で調整した値）と、失敗分類（eval 失敗 / タイムアウト / 出力欠落 / ペイロード報告失敗）を CLI 側へ返すエラーとして実装する
  - 完了条件: フェイク HookContext で成功・各失敗分類・タイムアウトの経路が単体テストで検証されている
  - _Requirements: 2.4, 2.5, 8.2, 8.4, 10.2_
  - Files: src/audio-remux/extract/run-extract.ts, tests/audio-remux/extract/run-extract.test.ts

- [ ] 5. フックオーケストレータと unity-render-core 統合を実装する
- [ ] 5.1 フックオーケストレータと失敗の構造化を実装する
  - afterRecording フック実装として、抽出 → 検証 → 計画 → 取得 → mux → 確定のフェーズ駆動を依存注入可能な形で組み立てる（Editor アクセスは抽出フェーズの eval 1 回のみ）
  - RenderHandoff から映像絶対パス（主出力 + 追加出力）・実効フレームレート・イン/アウト点を受け取り、出力（MP4 / MOV）ごとに mux を独立実行する
  - クリップ 0 件時はエラーとせず mux をスキップし、「音声トラックなし・無音の映像が最終成果物」を警告報告して正常終了する
  - あらゆる失敗を失敗区分（抽出 / ffmpeg 取得 / 合成）・保全映像パス・出力別成否を持つ構造化エラーとして reject し、core の Editor 未保存終了・原状復帰・バッチ継続を妨げない
  - デバッグモード時のフェーズ経過ログ・メタデータ/filter script の保持、無効時の詳細ログ非混在を実装する
  - 完了条件: フェイク依存一式で正常フロー・0 件スキップ・各失敗区分の伝搬と構造化エラーの内容（出力別成否・保全パス）が単体テストで検証されている
  - _Requirements: 8.2, 8.3, 8.5, 8.6, 9.2, 9.4, 10.2, 10.5, 10.6, 11.1, 11.2, 11.3_
  - Files: src/audio-remux/index.ts, src/audio-remux/types.ts, tests/audio-remux/index.test.ts

- [ ] 5.2 フェイク依存を用いた統合テスト一式を整備する
  - フック全体フローの統合テスト（正常・クリップ 0 件・抽出失敗・取得失敗・合成失敗の各シナリオ）を整備する
  - 2 出力独立 mux の検証（MP4 成功 + MOV 失敗で MP4 確定・MOV 無音保全・合成失敗としての reject と出力別成否報告）を整備する
  - 完了条件: 統合テストスイートが CI 相当のコマンド一発で全件成功する
  - _Requirements: 8.5, 8.6, 9.2, 9.4, 10.4, 10.6_
  - Files: tests/audio-remux/integration/hook-flow.test.ts, tests/audio-remux/integration/dual-output.test.ts

- [ ] 5.3 合成ルートへのフック登録と「映像成功・音声失敗」報告契約を検証する
  - 前提: core の合成ルート（core task 9.1）とフックレジストリ・Scene ジョブのフック発火（core tasks 8.2, 8.4）が実装済みであること
  - core の合成ルート（cli）で音声フックを登録し、Scene の書き出し成功ごとに呼び出されることを結合テストで確認する
  - フック reject 時に、core の既存 reporting（Scene 出力記録・フック失敗区分・成否一覧・終了コード）が**追加変更なしで**「映像成功・音声失敗」を映像書き出し失敗と区別して表現できることを結合テストで検証する
  - 表現できない場合は、必要最小限の core 側 reporting/型変更を実装し、design.md の Modified Files 節へ変更ファイルを追記する
  - 完了条件: 登録済みフックの発火と「映像成功・音声失敗」の区別表示（または core 側変更込みでの成立）が結合テストで検証されている
  - _Requirements: 8.1, 8.6, 10.5, 10.6_
  - Files: src/cli/index.ts, tests/audio-remux/integration/core-reporting.test.ts

- [ ] 6. 実 Unity + 実 ffmpeg での E2E 検証を実施する
- [ ] 6.1 同期精度 E2E（クリックトラック・複合ケース）を実施する
  - **判定基準（スパイク Q-10 でユーザー確定）**: 合否は **ffmpeg 出力のクリック位置が MixPlan の計算値と一致すること**で判定する。Unity Editor 実再生音との比較は参考値に留め、合否には用いない（design「Q-10 の同期精度判定基準」参照）
  - クリックトラック用テストアセット（既知位置の短音 + ネスト/変速/ループ構成）を書き出し、ffprobe でストリーム長差 ≤ 0.5 映像フレームを確認し、波形解析でクリック位置誤差を実測する
  - スパイクの資産を再利用する: フィクスチャは `spike/unity-project/Assets/Timeline/AudioSpikeRoot.playable`（必須複合ケース `A_Composite` を含む）、測定は `spike/timeline-audio/tools/analyze-wav.ps1`（オンセット / 区間 RMS / 基本周波数）、期待値は同 README の「時間換算の期待値」表
  - **必須複合ケース**として「ループ × 変速 × clipIn × イン点途中開始」を同時に満たす構成（ループクリップに clipIn と速度変更を設定し、イン点がクリップ再生中に位置する）を含めて検証する
  - 完了条件: 実測手順・測定値・成否がチェックリスト文書に記録され、許容誤差内であることが確認されている
  - _Requirements: 4.1, 4.5, 4.6, 6.1, 7.2, 7.3, 7.4_
  - Files: docs/e2e-audio-checklist.md

- [ ] 6.2 手動 E2E シナリオ（成否報告・欠落・オフライン復旧）を実施する
  - MP4 + MOV(ProRes) の 2 出力に対する音声合成一括実行と、最終成果物が設定どおりのファイル名で音声付きになっていることを確認する
  - 音源 1 件を意図的に欠落させ、「映像成功・音声失敗」として成否一覧に区別表示され、無音映像が保全されることを確認する
  - オフライン状態での初回実行で取得失敗メッセージ（原因切り分け + 手動配置手順）が表示され、manual 配置での復旧と 2 回目以降のオフライン動作を確認する
  - 完了条件: 手動シナリオの手順・実測結果・確認日時がチェックリスト文書に記録されている
  - _Requirements: 5.3, 5.6, 6.2, 9.1, 9.2, 10.1, 10.5_
  - Files: docs/e2e-audio-checklist.md

- [ ] 7. ユーザードキュメントを整備する
- [ ] 7.1 (P) ffmpeg のライセンス告知と手動配置手順を文書化する
  - 「ffmpeg は BtbN FFmpeg-Builds（LGPL ビルド）を初回実行時にユーザー環境へダウンロードする。再配布は行わない」旨・採用ビルド・取得元 URL・ソースコード入手先を明記する（スパイク Q-8 の最終確認結果に従う）
  - オフライン環境・配布元障害時の手動配置手順（取得元 URL・SHA-256・manual 配置先の絶対パス・確認方法）を記載する
  - install-info.json による採用ビルド・チェックサムの確認方法を記載する
  - 完了条件: ライセンス告知と手動配置手順を含む文書が存在し、エラーメッセージの案内先として参照可能である
  - _Requirements: 5.4, 5.6_
  - _Boundary: docs_
  - _Depends: 1.3_
  - Files: docs/ffmpeg.md

## Requirements Coverage

| Requirement | Tasks |
|---|---|
| 1.1–1.4 | 1.2, 4.2 |
| 2.1–2.6 | 2.1, 2.2, 2.3, 4.2, 4.3 |
| 3.1–3.3 | 2.1 |
| 4.1–4.6 | 2.3, 3.2, 6.1 |
| 5.1–5.7 | 3.1, 3.3, 4.1, 6.2, 7.1 |
| 6.1–6.5 | 3.2, 3.3, 6.1, 6.2 |
| 7.1–7.4 | 2.2, 2.3, 6.1 |
| 8.1–8.6 | 4.1, 4.2, 4.3, 5.1, 5.2, 5.3 |
| 9.1–9.4 | 3.4, 5.1, 5.2, 6.2 |
| 10.1–10.6 | 2.1, 3.3, 3.4, 4.3, 5.1, 5.2, 5.3, 6.2 |
| 11.1–11.3 | 3.3, 3.4, 5.1 |
| 12.1–12.3 | 1.1, 1.2, 1.3, 1.4, 1.5 |

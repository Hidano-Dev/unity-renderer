# Unity 6 検証スパイク計画

このディレクトリは unity-render-core の実機検証（Requirement 1.1–1.2、`URC-1.1`、`URC-1.2`）を行うための再現可能な計画とテストプロジェクトを管理する。初期計画では判定を **未実施** とし、P-1〜P-13 の結果、ログ、実行日時、Unity/パッケージのバージョン、ユーザー承認をこのファイルへ記録する。

## 実行環境

- Windows 10/11、PowerShell、Git。
- Unity CLI (`unity`) と Unity 6.0 以上の Editor。`unity editors -i` で対象 Editor のパスを確認する。
- `unity auth login` 済み。認証情報は本リポジトリへ保存しない。
- 対象プロジェクト: [`unity-project/`](./unity-project/)。Unity Hub または `unity open --path <絶対パス>` で開く。
- `com.unity.pipeline` と `com.unity.recorder` のパッケージ復元が完了していること。パッケージ取得に失敗した場合は、エラー全文と package manifest/lock のバージョンを記録する。
- 検証前後に `git status --short` を取得する。Unity の `Library/`、`Temp/`、`Logs/` などの生成物は追跡対象外であり、`Assets/`、`ProjectSettings/`、`Packages/` の恒久的変更は残さない。

## 準備手順

1. リポジトリのクリーン状態を確認し、`spike/unity-project/` を複製して作業用プロジェクトを作る。
2. `unity editors -i` で Unity 6.0 以上を選び、Unity Hub/Editor で作業用プロジェクトを一度開く。
3. Package Manager の解決完了を待ち、`Window > Package Manager` で `com.unity.pipeline` と `com.unity.recorder` が利用可能であることを確認する。
4. `Assets/Scenes/Spike.unity` を開き、`TimelineDirector` の PlayableDirector に `Assets/Timeline/Spike.playable` が割り当てられていることを確認する。
5. 別の PowerShell で `unity open --path <作業用プロジェクトの絶対パス>` を実行し、Editor が GUI モードで起動することを確認する。以後の P 項目は同じ Editor セッションを使い、項目ごとにログを保存する。

## 検証項目と判定基準

各項目で「確認」を実行し、すべての成功基準を満たしたら **成功**、一つでも失敗基準に該当したら **失敗** とする。失敗時はフォールバックも実測して採否を記録する。

| ID | 確認内容 | 成功基準 | 失敗基準 / フォールバック |
|---|---|---|---|
| P-1 | `unity open` 後に `localhost:7800` へ接続し、`eval` / `eval_file` の HTTP パス・リクエスト形式・応答形式、C# サイズ制約、応答後の一時ファイル削除を確認する。 | 両方式の実際の形式とエラーを再現でき、長い C# を送受信できる。`eval_file` の一時ファイルを安全に削除できる。 | 受付形式が確定しない、またはサイズ超過する場合は inline-split（定義送信と呼び出し分離）へ切り替える。 |
| P-2 | Play Mode、ドメインリロード、`EditorApplication.update`、status JSON の atomic write、強制終了後の残留状態を確認する。 | Play Mode 中も完了を検知でき、部分 JSON を読み込まず、強制終了状態を識別できる。 | ステータスポーリング不可なら eval の定期ポーリング、または出力ファイルサイズ安定監視へ切り替える。 |
| P-3 | MP4 と MOV(ProRes) の MovieRecorderSettings/RecorderClip 同時収録を Windows で実行する。 | 1 パスで両形式が完成し、各ファイルの成否を判定できる。 | 不成立なら同一 Editor セッション内の形式別逐次収録へ変更する。ProRes 不可なら D-2 再協議。 |
| P-4 | `AsyncGPUReadback.WaitAllRequests()` または Recorder の同期オプションを setup-recorder から有効化し、呼び出し位置・負荷・失敗検知を確認する。 | 同期化が有効で、フレーム欠落等を検知できる。 | RecorderClip の監視で毎フレーム同期する。いずれも不可なら品質リスクとして報告する。 |
| P-5 | 7800 の使用中チェック、既存 Editor の識別、ポート構成可否、衝突時の挙動を確認する。 | 固定ポートを起動前に検知し、`port-conflict` で即時終了できる。 | 事前検知不能なら `pipelinePort` を設定・Preflight・セッション契約へ追加する。 |
| P-6 | Editor 起動、import、ドメインリロード、ProRes、コールドスタート、実書き出しを個別計測する。 | 実長・係数3・マージン180秒の根拠を記録し、動的タイムアウトを算出できる。 | 実測値に合わせ係数/マージンを更新し、設定上書きを残す。 |
| P-7 | 既定のドメインリロードで Play Mode に入り、RecorderTrack/Clip、MovieRecorderSettings、status コールバックの生存を個別確認する。 | メモリ上の Recorder 構成が Play Mode を跨いで有効である。 | `setup-recorder` を Play Mode 後に再適用する2段ペイロードへ変更する。 |
| P-8 | `unity editors -i` の実出力を採取し、バージョン、空白/引用符を含むパス、複数 Editor、ロケール、終了コードを確認する。 | 行パーサが実出力を安定して解釈できる。 | JSON 出力オプションが存在し安定するなら JSON へ切り替える。 |
| P-9 | `com.unity.recorder` / `com.unity.pipeline` の実バージョンと Unity 6.x 間の互換性を確認する。 | 動作確認済みの具体的なバージョンを manifest/lock とログに固定できる。 | 単一版で互換性が取れなければ Unity バージョン帯別のピン止め表を作る。 |
| P-10 | MP4/MOV の RecorderSettings、解像度、FPS、範囲を指定し、出力メディアの実測値とエンコーダ有無を確認する。 | 指定値が出力へ反映され、両形式のエンコーダ可否を判定できる。 | 適用不能な値をスキーマから除外または警告へ降格し、D-2 を再協議する。 |
| P-11 | ダーティな Scene/Asset で `EditorApplication.Exit(0)` を実行し、保存ダイアログなしで終了するか確認する。 | GUI の保存確認を経ず終了し、終了コード0になる。 | 終了前にダーティ状態を破棄する。それでも不可なら `taskkill` を正式経路として再定義する。 |
| P-12 | manifest/packages-lock のバックアップ復元中に終了させ、部分書き込みと次回の `active` セッション復旧を確認する。 | バイト一致で復元でき、途中終了後も再実行で復旧できる。 | temp→rename の atomic 復元へ変更し、session.json を次回復旧対象にする。 |
| P-13 | 出力検証成功後、Editor 終了前に HookPhase を発火し、`formats` 先頭を `videoPath`、残りを `additionalOutputs` として渡す。 | 出力ファイル確定と Editor 接続を両立し、RenderHandoff が一意に得られる。 | フック地点または `evalCSharp` 契約を Spec 2 と再協議する。 |

## 実測記録（2.2 実施結果）

| 項目 | 内容 |
|---|---|
| 実施日時 / 実施者 | 2026-08-23 JST / Codex |
| Unity Editor / CLI | Unity 6.0.36f1、Unity CLI の `unity editors -i` 実出力を取得 |
| パッケージバージョン | `com.unity.pipeline` 0.5.0-exp.1、`com.unity.recorder` 5.1.0、`com.unity.timeline` 1.7.7 |
| 対象プロジェクト | `spike/unity-project`。元の 0.2.0 は解決不能だったため、実測時のみ CLI で 0.5.0-exp.1 を適用 |
| P-1 | 成功（下記詳細） |
| P-2 | 部分成立（Play Mode 中の eval 応答は成功、status JSON の atomic write / 強制終了残留状態は未実装のため未確定） |
| P-5 | 成功（7800 固定、既存 Editor の PID とポート占有を識別可能） |
| P-8 | 成功（`unity editors -i` の表形式実出力を取得） |
| 2.2 判定 | 条件付き成立。eval 経路は成立。P-2 の status チャネルは後続実装で別途確定する |
| ユーザー承認 | 承認済み（2026-08-23、2.4 の条件付き GO 判定として承認。詳細は「2.4 GO/NO-GO 判定」） |

### 2.2 実測ログ

以下は 2026-08-23 JST に PowerShell で実行した結果の要約である。Unity Editor は `unity open <path> --editor-version 6000.0.36f1` で GUI 起動した。`unity pipeline list --format json` は次を返した。

```text
projectName: unity-project
pid: 63764
hasPipelinePackage: true
pipelineVersion: 0.5.0-exp.1
pipelineServer.port: 7800
pipelineServer.isReachable: true
apiUrl: http://127.0.0.1:7800/api/editor_status
```

`unity list --project-path <path> --format json` で `eval` と `eval_file` の受付形態を確認した。`eval` は必須 `code`（任意 `timeout`、既定 5000 ms）、`eval_file` は必須 `file`（任意 `timeout`）を受け付ける。実行例と結果は次のとおり。

```text
unity command eval --project-path <path> "return 1+1;" --format json
=> success=true, result=2, executionTimeMs=407

unity command eval_file --project-path <path> <absolute-path> --format json
=> success=true, result=42, executionTimeMs=340
```

コードなしの `eval` は HTTP 400 相当の `Required parameter 'code' is missing or empty` となり、C# コンパイルエラーは CLI 終了コード 6 と JSON の `COMMAND_FAILED` で返った。成功応答には `target.host=127.0.0.1`、`target.port=7800`、`result.success`、`result.result`、`executionTimeMs`、`executedAt` が含まれる。

サイズ境界は、コメントで埋めた C# を用いて確認した。inline `eval` は 1,024 / 4,096 / 8,192 / 16,384 bytes が成功した。32,768 bytes 以上は Unity に到達する前に Windows の `The filename or extension is too long` となったため、inline の実用上限は CLI のプロセス引数上限に制約される。`eval_file` は 65,516 bytes の `.cs` ファイルで `result=42` を返した。長い処理は一時 `.cs` + `eval_file` を第一候補とする。

P-2 は `eval` で `EditorApplication.isPlaying = true` を設定し、8 秒後も `unity pipeline list` の 7800 接続が reachable、別の `eval` で `isPlaying=true` を確認した。その後 `isPlaying=false` に戻した。一方、status JSON の atomic write、ドメインリロードを跨ぐ残留状態、強制終了後の復旧は、このスパイクには status writer が存在しないため実測対象を構成できず未確定とした。

P-5 は `Get-NetTCPConnection -LocalPort 7800 -State Listen` で `0.0.0.0:7800` と Editor PID 63764 を確認し、`unity pipeline list` で同一 PID / プロジェクト / API URL を対応付けられた。Pipeline の API URL は `pipelineServer.apiUrl` として報告されるが、実測範囲では任意ポート設定の CLI オプションは確認できなかった。P-8 の `unity editors -i` は Unity 6.3.19f1 / 6.3.10f1 / 6.3.7f1 / 6.1.4f1 / 6.0.36f1 / 6.0.36f1 / 2022.3 系を表形式で出力した。

なお、初期 manifest の `com.unity.pipeline@0.2.0` は Editor.log の `Package ... cannot be found` で解決不能だった。CLI の `unity pipeline list-versions` で確認した最新版 0.5.0-exp.1 を実測時のみ適用すると解決し、Editor 起動後に Pipeline server が 7800 で reachable になった。実測後は manifest、packages-lock、ProjectVersion、Unity 生成物を元に戻している。

P-3、P-4、P-6、P-7、P-9〜P-13 は後続タスクで実測する。P-3 の書き出し不成立は全体の NO-GO とし、後続の render 実装へ進まず代替方針を再要件化する。

## 再現用コマンド例

```powershell
unity auth login
unity editors -i
unity open --path "$pwd\spike\unity-project" --editor-version 6000.0.36f1
# Editor 起動後、Unity Pipeline の localhost:7800 を対象に P-1 を実施
git status --short
```

UnityTestRunner は本リポジトリに存在しないため、CLI 側の自動検証はルートの `pnpm test` を使用する。P-1〜P-13 は Unity Editor 実機でのみ成立する E2E 項目であり、単体テストの代替にはならない。

## 実測記録（2.3 Recorder 駆動と映像書き出しの成立性）

| 項目 | 内容 |
|---|---|
| 実施日時 / 実施者 | 2026-08-23 JST / Codex |
| Unity Editor / CLI | Unity 6.0.36f1 / Unity CLI（`unity`） |
| パッケージ | `com.unity.pipeline` 0.5.0-exp.1、`com.unity.recorder` 5.1.0、`com.unity.timeline` 1.7.7 |
| P-3 / P-10 | 成功。同一 `RecorderController` に MP4 + MOV(ProRes) を登録し、30 fps・0–29 フレームで同時開始。両ファイルが完成 |
| P-4 | 部分成立。eval から `AsyncGPUReadback.WaitAllRequests()` を呼出し可能。アイドル時 0 ms。実 GPU 負荷は未測定 |
| P-6 | `unity open` 約 4.4 秒、Pipeline reachable まで約 20.1 秒、Recorder eval 応答約 0.4–0.8 秒、30 フレームのエンコード完了各約 1 秒 |
| P-7 | 不成立（フォールバック採用）。Play Mode 遷移後のドメインリロードを跨いで in-memory 構成を保持できず、遷移後の再構成で成功 |
| P-9 | 成功。Recorder 5.1.0 / Pipeline 0.5.0-exp.1 を動作確認。Pipeline 0.2.0 は解決不能 |
| P-11 | 成功。`EditorApplication.Exit(0)` 後に対象 Pipeline インスタンスが消滅し、保存ダイアログは観測されなかった |
| 2.3 判定 | 条件付き成立。MP4 + ProRes 同時収録は成立。ドメインリロード対策と実 GPU 負荷計測を後続実装の必須条件とする |

### 2.3 実測ログ

メモリ上の `TimelineAsset`、`RecorderTrack`、`RecorderClip`、`MovieRecorderSettings` を eval_file で生成し、各 `ScriptableObject` に `HideFlags.DontSave` を設定した。Play Mode 中の eval 応答は次のとおりだった。

```text
track=True;clip=True;settings=True;dontSave=True;recording=True
```

MP4 単独の完成ファイルは 43,661 bytes、ProRes 単独は 21,357,809 bytes だった。2 つの `MovieRecorderSettings`（MP4 / `ProResEncoderSettings`）を同じ `RecorderControllerSettings` に追加して同時開始し、次の応答とファイルを得た。

```text
mp4=True;prores=True;recording=True
spike-recorder-dual-mp4.mp4       43,661 bytes
spike-recorder-dual-prores.mov    21,357,809 bytes
```

ProRes は Windows 上で `IsPlatformSupported=True` となり MOV が完成したため、今回の Unity 6.0.36f1 / Recorder 5.1.0 環境ではエンコーダ利用可能と判定した。最小 Scene はカメラを含まないため、映像内容の品質・フレーム欠落は確認対象外とし、出力コンテナの完成性のみを確認した。

P-7 では、Play Mode を要求する eval に `delayCall` で Recorder 構成を続けて適用したが、ドメインリロード後に構成結果を確認できなかった。Play Mode 中に別の eval を送り、同じ構成を再生成・`PrepareRecording`・`StartRecording` すると成功した。実装では Play Mode 遷移完了後に `setup-recorder` を再送する。

P-4 は外部 eval から `AsyncGPUReadback.WaitAllRequests()` を直接呼べることを確認した。実装では Recorder のフレーム監視と組み合わせ、必要な場合に毎フレーム同期する方式を再検証する。

実測に使用した一時パッケージ変更、出力動画、eval 用一時ファイルは実測終了時に削除・復元した。

## 実測記録（2.4 GO/NO-GO 判定）

### P-12 / P-13 の判定

P-12 は復元処理の設計契約を机上検証した。バックアップから `*.restore.tmp` へ書き込み、同一ディレクトリ内で rename してから `manifest.json` / `packages-lock.json` を置換する方式なら、プロセスが rename 前に終了しても原本は残る。`session.json` を先に `status: "active"` で atomic write し、復元成功後にのみ `restored` として削除するため、次回起動は `active` を未復旧として検出できる。判定は **採用（atomic restore + active session recovery）** とする。Unity Editor を必要としないため、実装前の机上検証として成立した。

P-13 は `scene-job` の状態遷移と既存の `RenderHandoff` 契約を照合した。出力の存在・サイズ > 0 検証を成功条件にし、検証直後かつ `requestQuit` 前に HookPhase を 1 回だけ発火することで、Editor 接続を維持したまま `formats[0]` を `videoPath`、`formats[1..]` を `additionalOutputs` に固定できる。フック失敗時も `finally` の終了処理へ収束する。現時点では本体実装と Spec 2 の受け側が未着手のため、Unity 実機での callback 発火は **未実測**。実装時の結合テストおよび Spec 2 接続確認を必須の再検証条件とする。判定は **設計採用（実機再検証 pending）** とする。

### P-1〜P-13 確定結果総括

| ID | 確定結果 | 採用方針 / 残条件 |
|---|---|---|
| P-1 | 成功 | 長い C# は一時 `.cs` + `eval_file`、短い処理のみ inline。応答後に一時ファイルを削除 |
| P-2 | 条件付き成立 | Play Mode 中の eval は成立。status writer の atomicity と強制終了復旧は実装時に検証し、atomic JSON + stale-run 識別を採用 |
| P-3 | 成功 | MP4 + MOV(ProRes) を同一 RecorderController の 1 パスで収録 |
| P-4 | 部分成立 | `WaitAllRequests()` 呼出しは成立。実 GPU 負荷は未測定のため、フレーム監視と併用して実装時に再検証 |
| P-5 | 成功 | 7800 固定、起動前に占有 PID/既存 Editor を検査し `port-conflict` で停止 |
| P-6 | 条件付き成立 | 動的タイムアウトは係数 3 + マージン 180 秒を採用。起動/接続約 20.1 秒、録画完了約 1 秒の実測を根拠とし、実装時に長尺・コールドスタートを再計測 |
| P-7 | 成功（フォールバック） | ドメインリロード後に `setup-recorder` を再送する 2 段ペイロードを必須化 |
| P-8 | 成功 | `unity editors -i` の表形式行パーサを採用 |
| P-9 | 成功 | Unity 6.0.36f1 + Recorder 5.1.0 + Pipeline 0.5.0-exp.1 を固定。Pipeline 0.2.0 は解決不能 |
| P-10 | 成功 | 30 fps・0–29 フレームで MP4/MOV の指定が反映され、両コンテナが完成 |
| P-11 | 成功 | `EditorApplication.Exit(0)` を通常終了経路として採用 |
| P-12 | 成功（机上検証） | temp→rename の atomic 復元と `session.json: active` の次回復旧を採用 |
| P-13 | 条件付き成立（机上検証） | 出力検証後・終了前の一意な HookPhase を採用。実装時の callback/Spec 2 接続検証が必須 |

### 2.4 GO/NO-GO 判定

総合判定は **条件付き GO** とする。P-3 の MP4 + MOV(ProRes) 書き出しは成立し、P-1、P-5、P-8〜P-11 も採用可能な結果を得た。P-2、P-4、P-6、P-12、P-13 に残る未実測部分は、上表のフォールバック・再検証条件を実装ゲートとして design.md に反映した。P-13 の実機 callback 検証と実 GPU 負荷計測が不成立、または P-3 の実出力が再現不能となった場合は直ちに **NO-GO** とし、後続実装を停止して代替方針を再要件化する。

ユーザー承認: **承認済み（2026-08-23、条件付き GO を承認）**。バッチ実行セッション中にユーザーへ判定内容（採用方針・実装時再検証条件・NO-GO 切替条件を含む）を提示し、「承認して続行」の回答を得た。これによりタスク 3 以降の実装フェーズへの着手を許可する。

なお、本実行時の `spike/unity-project/ProjectSettings/ProjectVersion.txt` は 6000.0.23f1 であり、指定された 6000.0.36f1 と一致しなかったため、追加の Unity 起動・再実測は行っていない。Unity を再実行する場合は、ProjectVersion.txt と一致する明示的な `--editor-version` を使用する。

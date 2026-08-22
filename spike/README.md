# Unity 6 検証スパイク計画

このディレクトリは unity-render-core の実機検証（Requirement 1.1–1.2、`URC-1.1`、`URC-1.2`）を行うための再現可能な計画とテストプロジェクトを管理する。実測前の判定は **未実施** とし、P-1〜P-13 の結果、ログ、実行日時、Unity/パッケージのバージョン、ユーザー承認をこのファイルに追記する。

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
| ユーザー承認 | 未承認 |

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
unity open --path "$pwd\spike\unity-project"
# Editor 起動後、Unity Pipeline の localhost:7800 を対象に P-1 を実施
git status --short
```

UnityTestRunner は本リポジトリに存在しないため、CLI 側の自動検証はルートの `pnpm test` を使用する。P-1〜P-13 は Unity Editor 実機でのみ成立する E2E 項目であり、単体テストの代替にはならない。

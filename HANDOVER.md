# HANDOVER

## 今回やったこと

- **実機検証を完走**（前回まで 2 セッション積み残していた項目）。`feature/scene-selection-gui` の新規分 —— Scene 絞り込み GUI と RecorderTrack 掃除 —— は**すべて実機で通った**
- 検証用の RecorderTrack フィクスチャを **uloop（Unity CLI Loop）の `execute-dynamic-code` で機械生成**。Unity Editor の手作業なしで再現できるようにした
- 検証中に見つかったブランチ外のバグ 3 件を `docs/backlog.md` へ記録（B-1 は音声を持つ Scene の書き出しを確実に落とす重大度）

## 実機検証の結果

| 項目 | 結果 |
|---|---|
| 事前チェック（CLI / GUI 両方） | ✅ |
| 最小正常系（`Spike`、RecorderTrack なし） | ✅ exit 0 |
| RecorderTrack 掃除（`AudioSpike`） | ✅ exit 0 |
| 複数 Scene バッチ（3 本） | ✅ 進捗表示・部分失敗で exit 2 |
| GUI 絞り込み（実ブラウザ、45 Scene の実プロジェクト） | ✅ 全項目 |
| GUI のライブログ / ボタン無効化 | ✅ |
| 後始末（`.playable` 不変 / セッション復元 / repo clean） | ✅ |

### RecorderTrack 掃除の証拠

```
scan:   timelines=[ AudioSpikeRoot.playable        / chain "root"
                    AudioSpikeNestedL2.playable    / chain "root > ToNestedL1 > ToNestedL2" ]
        removed=0  timelineDurationSec=25.999...
remove: removed=2  timelineDurationSec=20.999...
start:  totalFrames=630
```

出力 mp4 を ffprobe で実測して `duration=21.000000` / `nb_frames=630`。**ControlTrack 2 段のネストまで辿れており、duration 短縮が出力ファイルの実長に反映されている**。

`.playable` は SHA-256 で前後比較して不変（**失敗した実行でも不変**）。`spike/unity-project/Recordings/` は生成されず、二重書き出しの阻止を確認。フィクスチャには**実物の `MovieRecorderSettings`（出力先 `Recordings/`）を付けた**ので、掃除が失敗していれば実際にファイルが生まれる —— この assertion は空振りしない。

### GUI 絞り込みの証拠

45 Scene のユーザー実プロジェクトで確認（`SampleScene` が大量にある想定そのもの）。

- `Suisei_Pajama` が Scene 名 `20260623_SuiseiPajama` に一致 —— Scene 名にはアンダースコアが無く `Assets/Suisei_Pajama/...` というパスにしか無いので、**パス側にも当たっていることの決定的な証拠**
- `GENERATED` で 20 件ヒット（大文字小文字を無視）
- 絞り込み中に「表示中をすべて ON」→ 表示中 1 件だけが ON。別の語で絞って ON → **前に選んだ隠れている Scene は選択されたまま**
- 「表示中をすべて OFF」も同様に表示中にだけ効く
- 絞り込み解除でボタン表記が「すべて ON / OFF」へ戻り、件数表示から「表示中 N 件」が消える
- 一致 0 件で「絞り込みに一致する Scene がありません。」
- 再読み込みで絞り込み文字列が復元され、隠れている Scene の選択も残る
- **`check` のログが `対象 Scene (2 件): ...2-B..., ...3-A...` を出した** —— 2-B は絞り込みで隠れていた Scene。隠れた選択が実行対象に入ることが実行経路で裏取りできた

## 決定事項

- **検証用フィクスチャは uloop で作る**。`spike/timeline-audio/tools/*.cs` + `unity command eval_file` でも作れるが、uloop の `execute-dynamic-code` は `--code-file` と `using UnityEditor.Recorder;` の直書きが通り、失敗時に `get-logs` で Editor コンソールを読める
- **uloop はフィクスチャ生成にだけ使い、測る前に撤去する**。uloop パッケージを入れると `Packages/manifest.json` / `packages-lock.json` / `ProjectSettings/PackageManagerSettings.asset` / `.uloop/` が変わり、検証の中核判定「`git status --short spike/unity-project` が差分ゼロ」と project-guard の manifest バックアップ対象を汚す。フェーズ A（uloop で生成）→ 撤去 → フェーズ B（出荷状態で計測）の順に分けた
- **`recorder-track-cleanup-failed` の実機再現は諦める**。`patchManifest()` が `com.unity.recorder` を無ければ追加し直す（`src/project-guard/manifest-patch.ts:38-45`）ため、manifest から抜いても型解決失敗にならない。Recorder の存在が保証される設計側の性質なので、エラー経路は unit test の担保に留める
- **ブランチ外のバグは `docs/backlog.md` に記録し、このブランチでは直さない**。B-1 は audio-remux の ZIP 展開で、Scene フィルタ / RecorderTrack と無関係

## 捨てた選択肢と理由

- **`uloop launch` で Editor を起動** → Editor が `D:\UnityEditors\` にあり、uloop は Hub 既定パスしか探さないため `unity 6000.0.36f1 executable not found`。`unity open` で起動すれば uloop は**起動元を問わずその Editor に接続する**ので、そちらを使った
- **`uloop skills install`** → skill が `spike/unity-project/.claude/skills` に入る。clean に保ちたいディレクトリなので入れず、`--help` の情報だけで足りた
- **RecorderClip を設定なしの空クリップにする** → 掃除が失敗しても二重書き出しが起きず、`Recordings/` 未生成という判定が空振りする。実物の `MovieRecorderSettings` を付けた
- **`AudioSpike` の検証で `range` を指定する** → 録画長が固定され、duration 短縮（26.0 → 21.0）が出力に現れなくなる。`range` を省いて全長録画した
- **GUI 検証でプロジェクトパスを spike に差し替える** → 利用者の保存済み GUI 状態を壊す。復元されていた実プロジェクト（45 Scene）でそのまま検証し、終了時に絞り込み・選択・出力先を元の値へ戻した

## ハマりどころ

- **`Set-Content -Encoding UTF8` は BOM を付ける**（PowerShell 5.1）。これで書いた `manifest.json` が `JSON.parse` で落ち、`Temporary package addition failed.` としか出ずに 1 秒で終わった。原因表示の改善は backlog B-3
- **`unity open` はフォアグラウンドで戻らない**。バックグラウンド実行にして、`.uloop/project-runner-pin.json` の生成でレディを判定した
- Unity を `uloop launch -q` で殺すと `Temp/UnityLockfile` が 0 byte で残る。ただし `checkProjectLock()` は `r+` で開けるかどうかで判定する（`src/project-guard/lock.ts:20-40`）ので stale 扱いで通る
- ブラウザ自動操作で `await` を挟んだ長い JS は CDP が 45 秒でタイムアウトすることがある。ボタン無効化の観測は **`click()` の直後に同期で `disabled` を読む**形にしたら一発で取れた（`start()` が fetch 前に `setRunning(true)` を呼ぶ実装なので同期で見える）
- PowerShell で native exe に `2>&1` を使うと 1 行ごとに `NativeCommandError` で包まれる。`Start-Process -RedirectStandardOutput/-RedirectStandardError` に切り替えた

## 学び

- **uloop の `execute-dynamic-code` は `using` を書ける**。この repo の `unity command eval` 経路（`PipelineEval_<hash>.Execute()` に包まれるため usings 不可・完全修飾必須）と違い、`using UnityEditor.Recorder;` を直書きして `tl.CreateTrack<RecorderTrack>()` / `track.CreateClip<RecorderClip>()` がそのまま通る。リフレクション回避で書けるぶん、フィクスチャ生成は圧倒的に楽
- **uloop の Editor 探索は Unity Hub の既定パスだけ**。`unity editors -i --format json` の `location` を見れば実際の場所が分かる（この環境は `D:\UnityEditors\`）
- **`unity-render` は音声のない Scene だと ffmpeg を要求しない**。`Spike` が通って `AudioSpike` が落ちた差はここ。B-1 が今まで表面化しなかった理由でもある
- 実行が 1 秒未満で終わる UI の状態遷移は、ポーリングでは捕まらない。**同期的に設定される状態は同期的に読む**

## 次にやること

1. **`docs/backlog.md` の B-1 を直す**（別ブランチ推奨）。ffmpeg 取得が初回に必ず失敗するため、音声を持つ Scene を書き出せない。修正自体は数行だが、ディレクトリエントリを含む zip の回帰テストを足すこと
2. B-2 の設計意図を確認（クリップ単位のスキップか Scene 失敗か）
3. 余力があれば: `render` 実行中の中断（キャンセル）ボタン、`range`（切り出し）の GUI 対応、`debug` チェックボックス

## 環境に残した変更

**`%LOCALAPPDATA%\unity-render-core\tools\ffmpeg\manual\` に ffmpeg 8.1.1（Gyan build）を置いてある。** B-1 を迂回して検証を完走するための措置。コードが用意している正規のフォールバック経路だが、**B-1 の症状を隠す**。B-1 を再現したいときは消すこと。

## 関連ファイル

新規:

- `docs/backlog.md` — ブランチ外バグ 3 件

検証に使った再現手順（コミットしていない。必要なら再生成する）:

```powershell
# フェーズ A: フィクスチャ生成
uloop package install --project-path spike\unity-project
unity open "<repo>\spike\unity-project" --editor-version 6000.0.36f1 --args "-automated" --non-interactive
uloop --project-path spike\unity-project execute-dynamic-code --code-file <build-recorder-track-fixture.cs>
uloop launch -q --project-path spike\unity-project
git checkout -- spike/unity-project/Packages spike/unity-project/ProjectSettings
Remove-Item -Recurse -Force spike\unity-project\.uloop

# フェーズ B: 計測（uloop 撤去後）
dist\unity-render.exe render <config>.json
```

フィクスチャ生成コードは `AudioSpikeRoot.playable`（clip 21.0–26.0、duration を 21.0 → 26.0 へ伸ばす）と `AudioSpikeNestedL2.playable`（clip 0.0–1.0）へ `RecorderTrack` + `RecorderClip` + `MovieRecorderSettings`（320×180、出力先 `Recordings/`）を追加し、`AssetDatabase.SaveAssets()` を最後に 1 回だけ呼ぶ。既存の `RecorderTrack` を先に消すので冪等。

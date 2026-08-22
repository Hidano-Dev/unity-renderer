# Requirements Document

## Project Description (Input)
timeline-audio-remux: Timeline（ControlTrack による入れ子構造を含む）のすべての AudioTrack から再生情報（音源アセットの元ファイルパス・ルート Timeline 基準の絶対開始時刻・clipIn・音量）を eval 実行の C# で抽出し、映像書き出し後に同梱 ffmpeg で複数音源をブレンドして unity-render-core が書き出した映像ファイルへ合成する機能。Unity Editor 再生時のミリ秒単位のランダムな音ズレを根本回避する、本ツールの核心的差別化機能。詳細な背景・決定済み事項・スコープ・未決事項は .kiro/multi-spec/unity-render-tool.md の「全体コンテクスト」「共通の決定済み事項」「Spec: timeline-audio-remux」の各節に記載されており、requirements 生成・dig インタビュー・design の前提として必ず読み込むこと。関連 spec: .kiro/specs/unity-render-core/ も参照（本 Spec は unity-render-core が提供する「書き出し完了後・Editor 終了前の eval フック」「映像ファイルパス・実効フレームレート・イン/アウト点の受け渡し（RenderHandoff）」を利用する）。

## Introduction

timeline-audio-remux は、Unity Timeline（ControlTrack による入れ子構造を含む）のすべての AudioTrack から再生情報を eval 実行の C# で抽出し、unity-render-core が書き出した無音の映像ファイルに対し、同梱 ffmpeg で複数音源をブレンドして合成（mux）する機能である。Unity Editor 再生時の音は必ずミリ秒単位でランダムにズレる（per plan G-10。発案者の実証記事に基づく）ため、音声は Unity Recorder では収録せず、Timeline の再生情報から外部で正確に再構築する。これが本ツールの核心的差別化機能である。

本書の主語 "timeline-audio-remux モジュール" は、unity-render-core と同一コードベース・同一 .exe に組み込まれる本機能の実装一式（TypeScript 実装、およびフック経由で Editor 内に送り込み実行させる音声情報抽出用 C# コードを含む）を指す。

## Boundary Context

- **In scope**: eval で実行する音声情報抽出 C#（ルート Timeline から ControlTrack を再帰的に辿る全階層 AudioTrack の走査、音源アセット元ファイルパス・ルート Timeline 基準絶対開始時刻・clipIn・音量の抽出、JSON 出力）、音声メタデータ JSON スキーマの定義（本 Spec 側の責務）、複数音源同時再生のブレンド／ミックス、同梱 ffmpeg による配置・ミックス・映像への mux、イン点／アウト点指定時の音声切り出し整合、ffmpeg のツール同梱（PATH 非依存）、デバッグモード時の ffmpeg ログ出力、unity-render-core のフック（RenderHooks / HookContext / RenderHandoff）との統合、最終成果物（音声合成済み映像）の生成、エラー処理（音源ファイル欠落・抽出失敗・ffmpeg 失敗時の挙動）。
- **Out of scope**: Scene 内に直接置かれた AudioSource（Timeline 外の音）、Timeline の AudioTrack 以外の発音（スクリプト再生・イベント駆動の SE 等）、サラウンド／空間音響（AudioSource の 3D 設定）の再現。
- **Adjacent expectations**: unity-render-core（Spec 1）から「書き出し完了後・Editor 終了前の eval フック（`RenderHooks.afterRecording` / `HookContext`）」「書き出した映像ファイルの絶対パス（主出力 + 追加出力）」「実効フレームレート」「イン点／アウト点」（`RenderHandoff`）を受け取る。unity-render-core の初期出力フォーマットは MP4 + MOV(ProRes) の 2 形式（per core D-2）であり、本 Spec の mux 対象は 2 コンテナとなる。音声メタデータ JSON スキーマの定義とフックで実行する抽出用 C# は本 Spec が unity-render-core に提供する。

## Open Questions and Decisions (Dig)

| ID | トピック | 決定 | 理由 | リスク |
|----|---------|------|------|--------|
| D-1 | 再現属性の初期範囲 | ミニマム（絶対開始時刻 + clipIn + クリップ音量）に加えて **AudioTrack 側ボリューム/ミュート** と **クリップ再生速度** を初期リリースで再現する。クリップのフェードイン/アウトは初期スコープ外 | ミュート済みトラックの音が鳴るのは実質バグであり除外は安価。変速クリップはタイミング・ピッチのズレに直結する。フェードは近似実装の割に優先度が低いと判断 | 中（再生速度の再現は atempo/asetrate の仕様確定が必要。ピッチの扱いは Unity 実挙動に合わせる方針とし design/スパイクで実測確定） |
| D-2 | ループクリップ | クリップ長 > 音源長のループ再生に**初期リリースで対応**する（ffmpeg で音源を繰り返してクリップ長分を埋める） | BGM・環境音のループは Timeline の頻出パターンで、非対応だと途中で音が止まる成果物になり本機能のコア価値を損なう | 低 |
| D-3 | ffmpeg の入手方式 | **同梱せず、初回起動時に公式配布元から自動ダウンロード**してツール管理ディレクトリに配置する（**plan S2-3「ツールに同梱する」を上書き**） | 配布物を軽くし、GPL/LGPL バイナリの同梱再配布に伴うライセンス義務を回避する。ダウンロード後の動作は PATH 非依存という S2-3 の本来の目的は維持 | 中（オフライン環境では初回セットアップ不可。取得元・検証・失敗時挙動の設計が必要 → D-4） |
| D-4 | ffmpeg 取得の詳細 | ツールが**バージョン固定の公式配布 URL と SHA-256 ハッシュを保持**し、ダウンロード後に検証する。取得失敗・オフライン時は手動配置手順（指定ディレクトリへの配置）を案内して当該 Scene の音声合成を失敗扱いとする | 再現性と改ざん耐性を確保する。配布元 URL 変更時はツール更新で追随 | 低 |
| D-5 | ControlClip の timeScale | 子 Timeline 全体の変速再生（timeScale）に**初期リリースで対応**する。祖先 ControlClip の timeScale を累積し、子階層クリップの絶対開始時刻・実効再生速度に反映する | クリップ単体の再生速度対応（D-1）と同じ変速合成機構を使い回せ、時刻換算は乗算のみ。非対応だとネスト変速時に全クリップのタイミングが狂う | 中（検証ケースが増える） |
| D-6 | 音声コーデック・サンプルレート | **コンテナに応じた自動選択**とする（例: MP4 → AAC、MOV(ProRes) → PCM。具体値・サンプルレートの定矩は design で確定）。設定項目にはしない | 設定項目を増やさず、配信用・編集用それぞれの定石に合わせる。ミニマム方針（G-12）とも整合 | 低 |

## Requirements

### Requirement 1: 音声情報抽出 — Timeline の再帰走査

**Objective:** ユーザーとして、Scene の Timeline 再生で実際に鳴るすべての AudioTrack の音を最終映像に含めたい。ネスト Timeline の音の取りこぼしがあると成果物として成立しないためである（per plan S2-1）。

#### Acceptance Criteria

1. When 音声情報抽出 C# がフック地点（書き出し完了後・Editor 終了前）で実行された, the timeline-audio-remux モジュール shall 書き出し対象 PlayableDirector のルート Timeline が持つすべての AudioTrack を走査対象に含める
2. When 走査中の Timeline に ControlTrack が存在し、そのクリップが子 Timeline（PlayableDirector）を参照している, the timeline-audio-remux モジュール shall 子 Timeline を再帰的に辿り、多段ネストを含む全階層の AudioTrack を走査対象に含める（per plan S2-1）
3. The timeline-audio-remux モジュール shall Scene 内に直接置かれた AudioSource、および Timeline の AudioTrack 以外の発音（スクリプト再生・イベント駆動の SE 等）を抽出対象に含めない
4. If ControlTrack のクリップの参照先が子 Timeline として解決できない（参照切れ・Timeline 以外の Playable）, then the timeline-audio-remux モジュール shall 該当クリップの走査をスキップし、走査全体は継続する（デバッグモード時にスキップ内容を特定できる情報を記録する）

### Requirement 2: 音声情報抽出 — 再生属性の抽出と JSON 出力

**Objective:** ツールとして、各オーディオクリップの再生を外部で正確に再構築するための最小属性を抽出したい。まず確実にタイミングの合う音を出すためである（per plan S2-4）。

#### Acceptance Criteria

1. When AudioTrack 上のオーディオクリップを検出した, the timeline-audio-remux モジュール shall 各クリップについて「音源アセットの元ファイルのパス（Assets 内の .wav/.mp3 等）」「ルート Timeline 基準の絶対開始時刻」「clipIn（頭出しオフセット）」「クリップ音量」（per plan S2-4）に加え、「クリップ長（ループ判定・打ち切りに使用）」「クリップ再生速度」「所属 AudioTrack のボリュームとミュート状態」を抽出する（see D-1 / D-2）
2. The timeline-audio-remux モジュール shall 音源として Unity のインポート加工後データではなく、アセットの元ファイル（.wav/.mp3 等）を直接参照する（per plan S2-2）
3. When ネストされた Timeline 上のクリップの開始時刻を算出する, the timeline-audio-remux モジュール shall 祖先の ControlClip の配置時刻および timeScale（多段ネスト時は累積）を反映して、ルート Timeline 基準の絶対開始時刻・実効再生速度へ換算する（see D-5）
4. When 走査と抽出が完了した, the timeline-audio-remux モジュール shall 抽出結果を音声メタデータ JSON としてファイルに出力し、CLI 側（TypeScript）が読み取れる形で受け渡す
5. If 抽出処理の実行中にエラーが発生し抽出結果 JSON を出力できない, then the timeline-audio-remux モジュール shall 失敗理由を含むエラーを CLI 側へ返す

### Requirement 3: 音声メタデータ JSON スキーマの定義

**Objective:** ツールとして、Editor 内の抽出 C# と CLI 側の合成処理をつなぐ受け渡し形式を本 Spec の責務として定義したい。unity-render-core はスキーマに関知しない契約になっているためである（per plan「他 Spec とのインターフェース」）。

#### Acceptance Criteria

1. The timeline-audio-remux モジュール shall 音声メタデータ JSON のスキーマを本 Spec の責務として定義し、Requirement 2 の抽出属性一式（音源元ファイルパス・絶対開始時刻・clipIn・音量）を表現できるものとする（フィールド構成・バージョニング等の詳細設計は design フェーズで確定する）
2. When CLI 側が音声メタデータ JSON を受領した, the timeline-audio-remux モジュール shall 定義済みスキーマに対して JSON を検証する
3. If 受領した JSON がスキーマに適合しない, then the timeline-audio-remux モジュール shall 音声合成を開始せず、不適合箇所を特定できるエラーを記録して当該 Scene の音声合成を失敗として扱う（Requirement 10 のエラー処理に従う）

### Requirement 4: 複数音源の同時再生ブレンド

**Objective:** ユーザーとして、複数の音源が同時に鳴る箇所でもすべての音が聞こえる映像が欲しい。ネスト Timeline により同時発音は通常ケースとして起きるためである（per plan S2-1）。

#### Acceptance Criteria

1. While 複数のオーディオクリップの再生区間が時間軸上で重なっている, the timeline-audio-remux モジュール shall 重なっている全クリップの音をミックス（ブレンド）して 1 本の音声ストリームへ合成する
2. When ミックスを実行する, the timeline-audio-remux モジュール shall 各クリップに抽出したクリップ音量および所属 AudioTrack のボリュームを適用したうえで合成する（see D-1）
3. The timeline-audio-remux モジュール shall 抽出されたすべてのクリップを合成対象とし、同時発音数に起因する取りこぼし（特定クリップの欠落）を発生させない
4. The timeline-audio-remux モジュール shall ミュートされた AudioTrack 上のクリップを合成対象から除外する（see D-1）
5. When クリップ再生速度が 1 以外のクリップを合成する, the timeline-audio-remux モジュール shall 再生速度を反映して合成する（ピッチの扱いは Unity Editor 再生の実挙動に一致させる。実挙動の確認と ffmpeg フィルタの選定は design フェーズで確定する。see D-1）
6. When クリップ長が音源長を超えるループ設定のクリップを合成する, the timeline-audio-remux モジュール shall 音源を繰り返してクリップ長分の音声を配置する（see D-2）

### Requirement 5: ffmpeg の取得と管理（初回自動ダウンロード）

**Objective:** ユーザーとして、ffmpeg を自分でインストール・設定せずに音声合成を使いたい。ユーザー環境への依存を無くすためである（plan S2-3 の目的を、同梱ではなく初回自動ダウンロードで満たす。see D-3）。

#### Acceptance Criteria

1. When ツール管理ディレクトリに ffmpeg が未取得の状態で音声合成が必要になった, the timeline-audio-remux モジュール shall ツールが保持するバージョン固定の公式配布 URL から ffmpeg を自動ダウンロードし、保持する SHA-256 ハッシュで検証したうえでツール管理ディレクトリに配置する（配布物には同梱しない。plan S2-3 を上書き。see D-3 / D-4）
2. When 音声合成を実行する, the timeline-audio-remux モジュール shall ツール管理ディレクトリに配置した ffmpeg のみを使用する（ユーザーの PATH 上の ffmpeg を参照・実行しない）
3. When ffmpeg を取得済みである, the timeline-audio-remux モジュール shall 以降の実行でダウンロードを行わず、オフラインでも音声合成を実行できる
4. The timeline-audio-remux モジュール shall ffmpeg を再配布しない取得方式により、ツール本体の配布物にバイナリ同梱由来のライセンス義務（GPL/LGPL のソース提供等）を発生させない。取得した ffmpeg のライセンス情報・取得元はユーザーが確認できる形で記録する
5. If 取得済みの ffmpeg バイナリが見つからない・実行できない, then the timeline-audio-remux モジュール shall 再ダウンロードを試み、それも失敗した場合は当該 Scene の音声合成を失敗として扱う
6. If ダウンロードまたはハッシュ検証が失敗した（オフライン環境を含む）, then the timeline-audio-remux モジュール shall 手動配置手順（取得元 URL と配置先ディレクトリ）を含むエラーを表示し、当該 Scene の音声合成を失敗として扱う（see D-4）

### Requirement 6: ffmpeg による音声合成と映像への mux

**Objective:** ユーザーとして、抽出した再生情報どおりに音源が配置・ミックスされた音声付き映像が欲しい。Editor 再生に依存しない正確なタイミングの音を得るためである（per plan G-10）。

#### Acceptance Criteria

1. When 音声メタデータ JSON と書き出し済み映像ファイルが揃った, the timeline-audio-remux モジュール shall 同梱 ffmpeg により各音源を絶対開始時刻・clipIn に従って時間軸上に配置し、ミックスした音声を映像ファイルへ mux して音声付き映像を生成する
2. The timeline-audio-remux モジュール shall unity-render-core の初期出力フォーマットである MP4 と MOV(ProRes) の両コンテナへの mux をサポートする（per core D-2）
3. When mux を実行する, the timeline-audio-remux モジュール shall 映像ストリームを再エンコードせずに合成し、書き出し済み映像の画質を劣化させない
4. The timeline-audio-remux モジュール shall 音声コーデック・サンプルレートを出力コンテナに応じて自動選択する（例: MP4 → AAC、MOV(ProRes) → PCM。具体的なコーデック設定値・サンプルレートの定矩は design フェーズで確定する。設定項目にはしない。see D-6）
5. The timeline-audio-remux モジュール shall ffmpeg による合成処理を Unity Editor プロセスに依存しない形で実行できる（Editor 終了後にも実行可能とする）

### Requirement 7: イン点／アウト点指定時の音声切り出し整合

**Objective:** ユーザーとして、書き出し範囲を指定した場合でも映像と音声が正確に同期した成果物が欲しい。部分書き出しでも音ズレ回避という本機能の価値を保つためである。

#### Acceptance Criteria

1. Where 書き出しにイン点／アウト点が指定されている, the timeline-audio-remux モジュール shall RenderHandoff の inPoint / outPoint を用いて、映像と同一区間の音声のみを合成する
2. When イン点より前に開始しイン点時点で再生中となるクリップが存在する, the timeline-audio-remux モジュール shall 該当クリップをイン点時点の再生位置（clipIn を含む経過分）から頭出しして合成する
3. When アウト点をまたいで再生が続くクリップが存在する, the timeline-audio-remux モジュール shall アウト点で該当クリップの音声を打ち切る
4. The timeline-audio-remux モジュール shall 合成後の音声の時間軸を映像の時間軸と一致させる（許容誤差の定義と検証方法は design フェーズで確定する）

### Requirement 8: unity-render-core フック統合

**Objective:** ツールとして、unity-render-core のジョブフローに音声処理を接続したい。書き出し完了後・Editor 終了前の唯一の拡張点で抽出を完了させる必要があるためである。

#### Acceptance Criteria

1. The timeline-audio-remux モジュール shall unity-render-core のフック拡張点（`RenderHooks.afterRecording`: 書き出し完了後・Editor 終了前）に登録され、Scene の書き出し成功ごとに呼び出される
2. When `afterRecording` フックが呼び出された, the timeline-audio-remux モジュール shall `HookContext` の eval 実行機能（`evalCSharp`）で音声情報抽出 C# を実行し、抽出結果 JSON を受け渡し用一時ディレクトリ（`sessionDir`）経由で受け取る
3. When 音声合成を実行する, the timeline-audio-remux モジュール shall `RenderHandoff` から映像ファイルの絶対パス（主出力および追加出力）・実効フレームレート・イン点／アウト点を受け取って使用する
4. The timeline-audio-remux モジュール shall Editor 内で実行する処理を音声情報の読み取り・抽出に限定し、シーン・アセット・プロジェクト設定への変更や保存を行わない（プロジェクト非介入原則。per plan G-8 の趣旨に準拠）
5. If フック実行（抽出）が失敗した, then the timeline-audio-remux モジュール shall 失敗を unity-render-core へフック失敗として返し、unity-render-core による Editor の未保存終了と原状復帰を妨げない

### Requirement 9: 最終成果物の生成

**Objective:** ユーザーとして、バッチ完了時に音声合成済みの最終映像ファイルを確実に受け取りたい。無音の中間映像と最終成果物を取り違えないためである。

#### Acceptance Criteria

1. When 音声合成が成功した, the timeline-audio-remux モジュール shall 音声合成済みの映像ファイルを最終成果物として生成する
2. When 書き出しが複数フォーマット（MP4 + MOV(ProRes)）で行われた, the timeline-audio-remux モジュール shall 主出力および追加出力のすべての映像ファイルに対して音声合成を行う
3. The timeline-audio-remux モジュール shall 最終成果物の配置方式（合成前の無音映像を置き換えるか、別名で保存するか）を design フェーズで決定し、いずれの方式でもユーザーが最終成果物を一意に識別できるようにする（per plan「他 Spec とのインターフェース」）
4. When Timeline から抽出されたオーディオクリップが 0 件である（AudioTrack が存在しない・全クリップが対象外）, the timeline-audio-remux モジュール shall これをエラーとせず、音声合成をスキップして無音の映像を最終成果物とし、音声なしであった旨を報告する

### Requirement 10: エラー処理（音源欠落・抽出失敗・ffmpeg 失敗）

**Objective:** ユーザーとして、音声合成に失敗しても書き出し済み映像を失わず、何が起きたかを正確に知りたい。長時間の書き出し結果を保全しつつ確実にトラブルシュートするためである。

#### Acceptance Criteria

1. If 抽出された音源アセットの元ファイルがディスク上に存在しない（欠落）, then the timeline-audio-remux モジュール shall 欠落したファイルパスと該当クリップを特定できるエラーを記録し、当該 Scene の音声合成を失敗として扱う（欠落音源を黙って除外した部分的なミックスを最終成果物としない）
2. If 音声情報抽出（eval 実行の C#）が失敗した, then the timeline-audio-remux モジュール shall 失敗理由を記録して当該 Scene の音声合成を失敗として扱う（Requirement 8 AC 5 に従い Editor 終了・原状復帰は継続される）
3. If ffmpeg の実行が失敗した（非 0 終了コード・プロセス起動失敗）, then the timeline-audio-remux モジュール shall 失敗理由を記録して当該 Scene の音声合成を失敗として扱う
4. If 当該 Scene の音声合成が失敗した, then the timeline-audio-remux モジュール shall unity-render-core が書き出した無音の映像ファイルを削除せず成果物として残す
5. When バッチの成否一覧を報告する, the timeline-audio-remux モジュール shall 「映像書き出しは成功したが音声合成に失敗した」Scene を、映像書き出し自体の失敗と区別できる形で報告する
6. If ある Scene の音声合成が失敗した, then the timeline-audio-remux モジュール shall バッチ全体を中断せず、後続 Scene の処理を継続させる

### Requirement 11: デバッグモード時のログ出力

**Objective:** 開発者・ユーザーとして、音声合成のトラブル時に ffmpeg の実行内容を追跡したい。通常利用ではシンプルな表示を保ちつつ原因調査を可能にするためである（per plan G-11）。

#### Acceptance Criteria

1. Where デバッグモードが有効である, the timeline-audio-remux モジュール shall ffmpeg の実行コマンドラインと実行ログ（標準エラー出力を含む）を出力に含める（per plan G-11）
2. While デバッグモードが無効である, the timeline-audio-remux モジュール shall ffmpeg の詳細ログを通常の進捗表示に混在させない
3. Where デバッグモードが有効である, the timeline-audio-remux モジュール shall 抽出した音声メタデータ JSON を調査用に保持する

## Dig Summary

- ラウンド数: 2 / 質問数: 6 / 決定数: 6（D-1〜D-6。plan の未決事項はすべて解決）

### 主要な発見

1. **ffmpeg は同梱せず初回自動ダウンロードに方針転換（D-3 / D-4）** — plan の決定 S2-3「ツールに同梱」をユーザーが明示的に上書き。バージョン固定 URL + SHA-256 検証で再現性を確保し、失敗時は手動配置手順を案内。配布物へのバイナリ同梱由来のライセンス義務を回避する
2. **変速系（クリップ再生速度＋ControlClip timeScale）を初期対応、フェードは見送り（D-1 / D-5）** — 推奨に含めたフェードイン/アウトをユーザーは選択せず、代わりに再生速度を選択。タイミング正確性 > 音量カーブ近似という優先順位が明確になった。ピッチの扱いは Unity 実挙動に合わせる（design/スパイクで実測確定）
3. **ループクリップ対応（D-2）** — BGM・環境音の頻出パターンとして初期リリースで音源繰り返し合成を行う

### 決定一覧

「Open Questions and Decisions (Dig)」の表を参照（D-1〜D-6）。

### 残存リスク（design フェーズへの引き継ぎ）

- 音声メタデータ JSON スキーマの詳細設計（Requirement 3 AC 1。design で確定）
- クリップ再生速度・timeScale 再現時のピッチ挙動: Unity Editor 再生の実挙動（ピッチ変動の有無）を実測し、ffmpeg フィルタ（asetrate / atempo 等）の選定に反映する
- ffmpeg 固定バージョンの選定と配布元 URL の安定性（gyan.dev / BtbN 等の選定は design で確定）
- Requirement 7 AC 4 の音声・映像時間軸一致の許容誤差定義と検証方法（design で確定）

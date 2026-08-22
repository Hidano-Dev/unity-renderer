# Requirements Document

## Project Description (Input)
timeline-audio-remux: Timeline（ControlTrack による入れ子構造を含む）のすべての AudioTrack から再生情報（音源アセットの元ファイルパス・ルート Timeline 基準の絶対開始時刻・clipIn・音量）を eval 実行の C# で抽出し、映像書き出し後に同梱 ffmpeg で複数音源をブレンドして unity-render-core が書き出した映像ファイルへ合成する機能。Unity Editor 再生時のミリ秒単位のランダムな音ズレを根本回避する、本ツールの核心的差別化機能。詳細な背景・決定済み事項・スコープ・未決事項は .kiro/multi-spec/unity-render-tool.md の「全体コンテクスト」「共通の決定済み事項」「Spec: timeline-audio-remux」の各節に記載されており、requirements 生成・dig インタビュー・design の前提として必ず読み込むこと。関連 spec: .kiro/specs/unity-render-core/ も参照（本 Spec は unity-render-core が提供する「書き出し完了後・Editor 終了前の eval フック」「映像ファイルパス・実効フレームレート・イン/アウト点の受け渡し（RenderHandoff）」を利用する）。

## Requirements
<!-- Will be generated in /kiro-spec-requirements phase -->

# Requirements Document

## Project Description (Input)
unity-render-core: Unity プロジェクト外部から Scene 名を指定し、公式 Unity CLI（unity open / unity command eval）で Editor を GUI モードで駆動して Unity Recorder による映像書き出しを行う TypeScript 製 Windows CLI ツールの本体。Unity Hub/Editor の自動検出とバージョン一致チェック、manifest.json/packages-lock.json のバックアップとパッケージ一時追加（com.unity.recorder / com.unity.pipeline）と原状復帰、メモリ上のみでの RecorderTrack/RecorderClip 構築、複数 Scene の直列バッチ実行と進捗表示までを含む。詳細な背景・決定済み事項・スコープ・未決事項は .kiro/multi-spec/unity-render-tool.md の「全体コンテクスト」「共通の決定済み事項」「Spec: unity-render-core」の各節に記載されており、requirements 生成・dig インタビュー・design の前提として必ず読み込むこと。

## Requirements
<!-- Will be generated in /kiro-spec-requirements phase -->

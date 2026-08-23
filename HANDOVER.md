# HANDOVER

## 今回やったこと

- `/kiro:spec-run unity-render-core` を完走（ブランチ `feature/unity-render-core`、main から分岐）
- 全 33 リーフタスクを codex exec で逐次実行: **32 OK / 1 FAIL（10.2 のみ）**。claude -p フォールバック発動 0 回
- スパイク（タスク 2.x）完了 → **条件付き GO をユーザーが承認**（`spike/README.md` に記録済み、コミット `429bfe3`）
- 実装検証を Codex（read-only）へ委譲 → 判定 NO-GO。ただし指摘の 1 つ（検証コマンド未実行）はローカル再実行で解消:
  - typecheck ✓ / lint ✓（警告 1 件のみ）/ vitest 34 ファイル 101 テスト全 pass / artgraph check ✓
  - `pnpm run build` で `dist/unity-render.exe` 生成、`--help` スモーク ✓
- tasks.md のチェック状態を実績と同期（10.2 のみ未チェックで残置、コミット `54870ae`）

## 決定事項

- spec.json の `tasks.approved` / `ready_for_implementation` を true に更新（spec-run 起動を承認とみなす。コミット `755fd12`）
- スパイク確定値: Unity 6000.0.36f1 + Recorder 5.1.0 + **com.unity.pipeline 0.5.0-exp.1**（0.2.0 は解決不能）
- Unity 起動規則（`spike/AGENTS.md` に恒久化）:
  - 必ず `--editor-version 6000.0.36f1`（ProjectVersion.txt と完全一致）でピン止め
  - **`-automated` フラグ必須**（ユーザー指示。ダイアログ抑止、GUI モード維持、batchmode 不使用）
  - 実装側は `unity open <path> --editor-version <ver> --args=-automated` 形式（session.ts）
- bun はプロジェクトローカル devDependency（bun 1.4.0、`pnpm exec bun`）。グローバル導入しない
- pnpm のビルドスクリプト許可は `pnpm-workspace.yaml` の `allowBuilds`（package.json の `pnpm` フィールドは pnpm v11 で無効）
- C# テンプレート埋め込み: Bun 側は `.cs` を text import、vitest 側は vitest.config.ts の `rawCsharpTemplatePlugin` で対応（`?raw` サフィックスは廃止）

## 捨てた選択肢と理由

- **codex の FAIL 出力をそのまま記録**（タスク 1）→ 実体は全完了条件クリアで、FAIL 理由が「UnityTestRunner 不在」のみ。全タスクで再発し連続失敗ガードが誤作動するため、OK 判定＋以降のプロンプトに代替検証指示（vitest 代替可）を追加
- **bun のグローバルインストール** → システム変更を避けプロジェクトローカルに
- **10.2 FAIL 後の修正ループ継続** → spec-run は無人実行前提のソフトゲート。2 回目の FAIL（録画未完走）は実装課題のため記録して先へ進めた
- **`?raw` import の維持** → Bun が解決できず build 不能。両対応方式へ変更（codex が実施）

## ハマりどころ

- **spec.json 未承認で codex が preflight 停止**: タスク 2.3 初回 FAIL の原因。kiro-impl skill の承認チェックを読むセッションと読まないセッションがあり挙動が不安定
- **ProjectVersion.txt の捏造値**: タスク 2.1 が `6000.0.23f1 (b1b1b1b1b1b1)` という架空バージョンを手書きコミット → ピン止め起動と食い違い、ユーザー環境でバージョン不一致・Library リセットダイアログが多発。実値 `6000.0.36f1 (9fe3b5f71dbb)` に修正済み（コミット `ec3faf8`）
- **codex の「クリーンアップ」が正しい値を捏造値に戻す**: 2.3 実測後の復元で Unity が書いた正値が巻き戻された。生成ファイルの「復元」はコミット済み内容が正とは限らない
- **Codex read-only サンドボックスは pnpm 実行不可**: validate-impl の検証コマンドが全拒否 → 証跡はローカルで補完する運用が必要

## 学び

- codex exec への指示は「UnityTestRunner 不在時は vitest 代替可・不在自体は FAIL 理由にしない」等、失敗判定の縁を明示しないと誤 FAIL する
- Unity プロジェクトの雛形を LLM に手書きさせると ProjectVersion 等に捏造値が入る。Unity 自身に書かせた値を正とする
- `unity open` の Editor 引数転送は `--args=-automated` 形式（`-- -automated` ではない）

## 次にやること

1. **［最優先］10.2 実機 E2E の録画未完走の調査**: Package 解決・固定版起動・Pipeline 疎通・ペイロード実行までは成立。録画開始後に status/output が生成されない。P-2（status writer atomicity）/ P-13（実機フック発火）の再検証条件と同根。実測記録は `docs/e2e-checklist.md`（MANUAL_VERIFY_REQUIRED）
2. 原因修正後 `/kiro:spec-run unity-render-core` 再実行（未チェックの 10.2 だけ再実行される）
3. 10.2 完了後、validate-impl を再実行して NO-GO を解消
4. push / PR 作成（ユーザー許可待ち。マージ判断は必ずユーザーに仰ぐ）
5. MINOR 指摘: lint 警告 1 件（open-scene.test.ts の不要エスケープ、FIXABLE）、artgraph trace 実行証跡の記録

## 関連ファイル

- `.kiro/specs/unity-render-core/`（spec.json / requirements.md / design.md / tasks.md）
- `spike/README.md` — P-1〜P-13 実測記録・条件付き GO・ユーザー承認
- `spike/AGENTS.md` — Unity 起動規則（ピン止め + -automated）
- `spike/unity-project/` — 検証用 Unity プロジェクト（6000.0.36f1）
- `docs/e2e-checklist.md` — 10.2 実測チェックリスト（未完了項目あり）
- `docs/setup.md` — 初回セットアップ手順
- `src/`（shared / config / unity-env / project-guard / csharp-payloads / editor-session / batch / hooks / reporting / cli）
- `tests/` — 34 ファイル 101 テスト（全 pass）
- `.github/workflows/ci.yml`、`package.json`、`pnpm-workspace.yaml`、`vitest.config.ts`

---
description: Analyze implementation gap between requirements and existing codebase
allowed-tools: Read, Task
argument-hint: <feature-name>
---

# Implementation Gap Validation

## Parse Arguments
- Feature name: `$1`

## Validate
Check that requirements have been completed:
- Verify `.kiro/specs/$1/` exists
- Verify `.kiro/specs/$1/requirements.md` exists

If validation fails, inform user to complete requirements phase first.

## Invoke Codex (primary)

**Validation runs on Codex, not on a Claude subagent** (user policy). Delegate via the `codex:codex-rescue` subagent, which forwards the task to the Codex CLI runtime. The task MUST be explicitly read-only (validation never edits files).

```
Task(
  subagent_type="codex:codex-rescue",
  description="Codex gap analysis",
  prompt="""
Read-only で以下のギャップ分析を実施してほしい。ファイル編集は一切禁止（レビュー・診断のみ）。

Feature: $1
Spec directory: .kiro/specs/$1/

読むべきファイル:
- .kiro/specs/$1/spec.json
- .kiro/specs/$1/requirements.md
- .kiro/steering/*.md
- .kiro/settings/rules/gap-analysis.md（存在する場合）
- 既存コードベースの関連箇所（requirements との突き合わせに必要な範囲）

requirements.md と既存コードベースのギャップを分析し、日本語で構造化レポートを返すこと:
- 総合判定（PASS / PASS with warnings / CRITICAL issues found）
- Findings 一覧（CRITICAL / MINOR に分類し、requirements の推奨修正文言を添える）
- 要件と既存資産の対応マップ（新規作成 / 拡張 / 競合）
- 実装アプローチの選択肢と工数・リスク見積り
"""
)
```

Apply any resulting requirement fixes in the main session (Codex は読み取り専用で実行するため、修正の適用は呼び出し側が行う).

### Fallback (Codex unavailable)

If the Codex invocation fails or returns nothing (Codex CLI 未セットアップ・usage-limit 等), fall back to the original Claude subagent and note the fallback in the result:

```
Task(
  subagent_type="validate-gap-agent",
  description="Analyze implementation gap",
  prompt="""
Feature: $1
Spec directory: .kiro/specs/$1/

File patterns to read:
- .kiro/specs/$1/spec.json
- .kiro/specs/$1/requirements.md
- .kiro/steering/*.md
- .kiro/settings/rules/gap-analysis.md
"""
)
```

## Display Result

Show Subagent summary to user, then provide next step guidance:

### Next Phase: Design Generation

**If Gap Analysis Complete**:
- Review gap analysis insights
- Run `/kiro:spec-design $1` to create technical design document
- Or `/kiro:spec-design $1 -y` to auto-approve requirements and proceed directly

**Note**: Gap analysis is optional but recommended for brownfield projects to inform design decisions.
---
description: Interactive technical design quality review and validation
allowed-tools: Read, Task
argument-hint: <feature-name>
---

# Technical Design Validation

## Parse Arguments
- Feature name: `$1`

## Validate
Check that design has been completed:
- Verify `.kiro/specs/$1/` exists
- Verify `.kiro/specs/$1/design.md` exists

If validation fails, inform user to complete design phase first.

## Invoke Codex (primary)

**Validation runs on Codex, not on a Claude subagent** (user policy). Delegate via the `codex:codex-rescue` subagent, which forwards the task to the Codex CLI runtime. The task MUST be explicitly read-only (validation never edits files).

```
Task(
  subagent_type="codex:codex-rescue",
  description="Codex design review",
  prompt="""
Read-only で以下の技術設計レビューを実施してほしい。ファイル編集は一切禁止（レビュー・診断のみ）。

Feature: $1
Spec directory: .kiro/specs/$1/

読むべきファイル:
- .kiro/specs/$1/spec.json
- .kiro/specs/$1/requirements.md
- .kiro/specs/$1/design.md
- .kiro/steering/*.md
- .kiro/settings/rules/design-review.md（存在する場合）

design.md を requirements.md との整合性・設計品質の観点でレビューし、日本語で構造化レポートを返すこと:
- 総合判定（GO / NO-GO）
- 要件カバレッジ（design でカバーされていない要件・AC の列挙）
- 内部矛盾・設計上の懸念（CRITICAL / MINOR に分類し、design.md の推奨修正文言を添える）
- テスト容易性・運用面の指摘
"""
)
```

Apply any resulting design fixes in the main session (Codex は読み取り専用で実行するため、修正の適用は呼び出し側が行う).

### Fallback (Codex unavailable)

If the Codex invocation fails or returns nothing (Codex CLI 未セットアップ・usage-limit 等), fall back to the original Claude subagent and note the fallback in the result:

```
Task(
  subagent_type="validate-design-agent",
  description="Interactive design review",
  prompt="""
Feature: $1
Spec directory: .kiro/specs/$1/

File patterns to read:
- .kiro/specs/$1/spec.json
- .kiro/specs/$1/requirements.md
- .kiro/specs/$1/design.md
- .kiro/steering/*.md
- .kiro/settings/rules/design-review.md
"""
)
```

## Display Result

Show Subagent summary to user, then provide next step guidance:

### Next Phase: Task Generation

**If Design Passes Validation (GO Decision)**:
- Review feedback and apply changes if needed
- Run `/kiro:spec-tasks $1` to generate implementation tasks
- Or `/kiro:spec-tasks $1 -y` to auto-approve and proceed directly

**If Design Needs Revision (NO-GO Decision)**:
- Address critical issues identified
- Re-run `/kiro:spec-design $1` with improvements
- Re-validate with `/kiro:validate-design $1`

**Note**: Design validation is recommended but optional. Quality review helps catch issues early.
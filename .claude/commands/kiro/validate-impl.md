---
description: Validate implementation against requirements, design, and tasks
allowed-tools: Read, Task
argument-hint: [feature-name] [task-numbers]
---

# Implementation Validation

## Parse Arguments
- Feature name: `$1` (optional)
- Task numbers: `$2` (optional)

## Auto-Detection Logic

**Perform detection before invoking Subagent**:

**If no arguments** (`$1` empty):
- Parse conversation history for `/kiro:spec-impl <feature> [tasks]` patterns
- OR scan `.kiro/specs/*/tasks.md` for `[x]` checkboxes
- Pass detected features and tasks to Subagent

**If feature only** (`$1` present, `$2` empty):
- Read `.kiro/specs/$1/tasks.md` and find all `[x]` checkboxes
- Pass feature and detected tasks to Subagent

**If both provided** (`$1` and `$2` present):
- Pass directly to Subagent without detection

## Invoke Codex (primary)

**Validation runs on Codex, not on a Claude subagent** (user policy). Perform the auto-detection above in the main session first, then delegate via the `codex:codex-rescue` subagent, which forwards the task to the Codex CLI runtime. The task MUST be explicitly read-only (validation never edits files; テスト・ビルド等の検証コマンドの実行は可).

```
Task(
  subagent_type="codex:codex-rescue",
  description="Codex impl validation",
  prompt="""
Read-only で以下の実装検証を実施してほしい。ファイル編集は一切禁止（テスト・ビルド・lint 等の検証コマンド実行と診断のみ）。

Feature: {$1 or auto-detected}
Target tasks: {$2 or auto-detected}
Mode: {auto-detect, feature-all, or explicit}

読むべきファイル:
- .kiro/specs/{feature}/*.{json,md}（requirements.md / design.md / tasks.md）
- .kiro/steering/*.md
- 対象タスクが変更した実装・テストコード一式

実装を requirements / design / tasks と突き合わせて検証し、日本語で構造化レポートを返すこと:
- 総合判定（GO / NO-GO）
- タスクごとの検証結果（要件充足・design 逸脱・テスト有無と結果）
- 指摘一覧（CRITICAL / MINOR に分類し、修正方針を添える）
- 実行した検証コマンドとその出力要約
"""
)
```

Apply any resulting fixes via the implementation flow (`/kiro:spec-impl` 等) in the main session — Codex の検証実行自体はファイルを変更しない.

### Fallback (Codex unavailable)

If the Codex invocation fails or returns nothing (Codex CLI 未セットアップ・usage-limit 等), fall back to the original Claude subagent and note the fallback in the result:

```
Task(
  subagent_type="validate-impl-agent",
  description="Validate implementation",
  prompt="""
Feature: {$1 or auto-detected}
Target tasks: {$2 or auto-detected}
Mode: {auto-detect, feature-all, or explicit}

File patterns to read:
- .kiro/specs/{feature}/*.{json,md}
- .kiro/steering/*.md

Validation scope: {based on detection results}
"""
)
```

## Display Result

Show Subagent summary to user, then provide next step guidance:

### Next Steps Guidance

**If GO Decision**:
- Implementation validated and ready
- Proceed to deployment or next feature

**If NO-GO Decision**:
- Address critical issues listed
- Re-run `/kiro:spec-impl <feature> [tasks]` for fixes
- Re-validate with `/kiro:validate-impl [feature] [tasks]`

**Note**: Validation is recommended after implementation to ensure spec alignment and quality.

# Agentic SDLC and Spec-Driven Development

Kiro-style Spec-Driven Development on an agentic SDLC

## Project Memory
Project memory keeps persistent guidance (steering, specs notes, component docs) so Codex honors your standards each run. Treat it as the long-lived source of truth for patterns, conventions, and decisions.

- Use `.kiro/steering/` for project-wide policies: architecture principles, naming schemes, security constraints, tech stack decisions, api standards, etc.
- Use local `AGENTS.md` files for feature or library context (e.g. `src/lib/payments/AGENTS.md`): describe domain assumptions, API contracts, or testing conventions specific to that folder. Codex auto-loads these when working in the matching path.
- Specs notes stay with each spec (under `.kiro/specs/`) to guide specification-level workflows.

## Project Context

### Paths
- Steering: `.kiro/steering/`
- Specs: `.kiro/specs/`

### Steering vs Specification

**Steering** (`.kiro/steering/`) - Guide AI with project-wide rules and context
**Specs** (`.kiro/specs/`) - Formalize development process for individual features

### Active Specifications
- Check `.kiro/specs/` for active specifications
- Use `$kiro-spec-status [feature-name]` to check progress

## Development Guidelines
- Think in English, generate responses in Japanese. All Markdown content written to project files (e.g., requirements.md, design.md, tasks.md, research.md, validation reports) MUST be written in the target language configured for this specification (see spec.json.language).

## Minimal Workflow
- Phase 0 (optional): `$kiro-steering`, `$kiro-steering-custom`
- Discovery: `$kiro-discovery "idea"` — determines action path, writes brief.md + roadmap.md for multi-spec projects
- Phase 1 (Specification):
  - Single spec: `$kiro-spec-quick {feature} [--auto]` or step by step:
    - `$kiro-spec-init "description"`
    - `$kiro-spec-requirements {feature}`
    - `$kiro-validate-gap {feature}` (optional: for existing codebase)
    - `$kiro-spec-design {feature} [-y]`
    - `$kiro-validate-design {feature}` (optional: design review)
    - `$kiro-spec-tasks {feature} [-y]`
  - Multi-spec: `$kiro-spec-batch` — creates all specs from roadmap.md in parallel by dependency wave
- Phase 2 (Implementation): `$kiro-impl {feature} [tasks]`
  - Without task numbers: autonomous mode (subagent per task + independent review + final validation)
  - With task numbers: manual mode (selected tasks in main context, still reviewer-gated before completion)
  - `$kiro-validate-impl {feature}` (standalone re-validation)
- Progress check: `$kiro-spec-status {feature}` (use anytime)

## Skills Structure
Skills are located in `.agents/skills/kiro-*/SKILL.md`
- Each skill is a directory with a `SKILL.md` file
- Use `/skills` to inspect currently available skills
- Invoke a skill directly with `$kiro-<skill-name>`
- `kiro-review` — task-local adversarial review protocol used by reviewer subagents
- `kiro-debug` — root-cause-first debug protocol used by debugger subagents
- `kiro-verify-completion` — fresh-evidence gate before success or completion claims
- **If there is even a 1% chance a skill applies to the current task, invoke it.** Do not skip skills because the task seems simple.

## Collaboration Modes (Optional)
Enable collaboration modes in `~/.codex/config.toml` to let Codex choose focused execution modes for longer tasks:

```toml
[features]
collaboration_modes = true
```

## Multi-Agent (Experimental)
If multi-agent is available, use it to parallelize independent research and validation within skills. Enable in `~/.codex/config.toml`:

```toml
[features]
multi_agent = true
```

Skills with "Parallel Research" sections list independent work items that benefit from sub-agent spawning when this feature is active.

## Development Rules
- 3-phase approval workflow: Requirements → Design → Tasks → Implementation
- Human review required each phase; use `-y` only for intentional fast-track
- Keep steering current and verify alignment with `$kiro-spec-status`
- Follow the user's instructions precisely, and within that scope act autonomously: gather the necessary context and complete the requested work end-to-end in this run, asking questions only when essential information is missing or the instructions are critically ambiguous.

## Steering Configuration
- Load entire `.kiro/steering/` as project memory
- Default files: `product.md`, `tech.md`, `structure.md`
- Custom files are supported (managed via `$kiro-steering-custom`)


<!-- artgraph:begin -->
<!-- artgraph: generated for packageManager=pnpm. If you switch package managers, re-run `pnpm exec artgraph init --force` to regenerate this block. -->
## artgraph — Cross-agent traceability

artgraph manages the trace lock and provides 6 Skills for spec ↔ code ↔ test traceability.

### Available Skills

- `artgraph-setup` — install artgraph in this project (also reports install state and wires late-added SDD tools)
- `artgraph-bootstrap` — bootstrap spec/@impl/test tags in an existing project (LLM proposes, artgraph check verifies)
- `artgraph-impact` — file/symbol → REQs impact
- `artgraph-plan-coverage` — reverse audit of tasks.md / plan.md
- `artgraph-verify` — `pnpm exec artgraph check --diff` self-check
- `artgraph-rename` — safe rename / split / merge of REQ IDs

See `<agent_skills_path>/<skill-name>/SKILL.md` for each Skill's full description (where `<agent_skills_path>` is `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.kiro/skills/` depending on your agent).

### Common workflows

- After editing `tasks.md` / `plan.md`: run **artgraph-plan-coverage** to catch implicit REQ impacts.
- Before review: run **artgraph-verify** (`pnpm exec artgraph check --diff`).
- CI gate for PRs: `pnpm exec artgraph check --diff --base origin/<base> --gate` judges only what the PR's commit range introduced (needs `fetch-depth: 0`; fail-closed exit 1 on a shallow clone).
- When proposing a code change: invoke **artgraph-impact** with `path:symbol`.
- With trace shards present (`@hidano/artgraph/vitest` runner): `pnpm exec artgraph impact --diff --tests` selects only the tests exercising a change (in CI add `--base origin/<base>` to select from the PR's commit range; exit 1 → fall back to the full suite); `pnpm exec artgraph trace report` cross-checks `@impl` claims against execution evidence.

`artgraph init` also wires up an automatic gate hook for agents that support one (Claude Code / Codex CLI Stop hook, Kiro IDE agent-stop hook): it runs `pnpm exec artgraph check --gate --diff` after each turn so drift surfaces immediately, without waiting for CI.

### Quickstart

```bash
pnpm exec artgraph init --agents=<list>   # provision Skills + agent-context
pnpm exec artgraph doctor                 # diagnose distribution health
```

For full CLI reference, run `pnpm exec artgraph --help` or see https://github.com/mori-shin-x/artgraph.
<!-- artgraph:end -->

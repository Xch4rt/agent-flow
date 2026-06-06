# Agent Flow

Agent Flow is a local workflow and memory layer for AI coding agents, with first-class support for Codex and Claude Code.

> Never explain your repo twice.

## What It Is

Agent Flow helps AI coding agents understand a repository once, save the useful context, and reuse it across future coding sessions.

It is not a generic agent framework. It is a small developer tool for project continuity: onboarding a repo, resuming context, planning work, verifying changes, and closing a session with useful memory.

Codex uses `.codex/skills/`. Claude Code uses `CLAUDE.md` and `.claude/skills/`. Shared Agent Flow memory remains `.planning/` and `.memory/`. The core value is the same across agents: avoid repeatedly explaining the repo.

## The Problem

AI coding sessions often start with the same manual explanation:

- What this repo does
- Which files matter
- How to run tests
- What was decided last time
- What is safe to change
- What still needs attention

Agent Flow turns that repeated explanation into repo-local planning files, memory entries, and Codex skills.

## Daily Usage

**Before Agent Flow:**

- Explain the repo again.
- Paste architecture notes.
- Tell Codex what files matter.
- Repeat prior decisions and known errors.
- Waste tokens and risk missing context.

**After Agent Flow:**

```sh
agent-flow start "fix billing webhook"
# paste the context pack into Codex
# work with $flow-quick or $flow-plan
agent-flow close
```

That is the daily loop. `start` builds a compact context pack with project state, relevant memory, and verification commands. `close` saves what happened so the next session picks up where you left off.

## Quick Start

Run without adding it to your project:

```sh
npx @xch4rt/agent-flow
npx @xch4rt/agent-flow init --codex
npx @xch4rt/agent-flow onboard
```

Or install the CLI globally:

```sh
npm install -g @xch4rt/agent-flow
```

Check the CLI:

```sh
agent-flow --help
```

Run the dashboard:

```sh
agent-flow
```

For local development:

```sh
pnpm install
pnpm build
pnpm link --global
```

Initialize a project:

```sh
agent-flow init --codex    # for Codex
agent-flow init --claude   # for Claude Code
agent-flow init --agent all  # for both
agent-flow onboard
```

Or just run `agent-flow` in an uninitialized repo for guided setup.

## Daily Workflow

Agent Flow is built around this loop:

```text
init -> onboard -> start -> work -> close
```

First-time setup:

1. Run `agent-flow init --codex`
2. Run `agent-flow onboard`
3. Run `agent-flow doctor`

Or just run `agent-flow` in an uninitialized repo and follow the guided setup.

Daily use:

1. Start with `agent-flow start "your task"` (or `$flow-resume` inside Codex, `/flow-resume` inside Claude Code)
2. Paste the context pack into your agent
3. Use `$flow-quick` for small scoped changes
4. Use `$flow-plan` for larger work
5. Use `$flow-verify` before commit or handoff
6. End with `agent-flow close` (or `$flow-close` inside Codex)

Useful CLI checks:

```sh
agent-flow status
agent-flow doctor
agent-flow context "fix billing webhook" --stats
agent-flow memory list
agent-flow memory search "auth"
agent-flow memory query "billing webhook"
```

## Dashboard

Running `agent-flow` without a subcommand opens the terminal dashboard. It shows the current project, branch, memory status, execution mode, memory mode, and the main workflow menu.

The dashboard is interactive in a real terminal:

- Use arrow keys or `j`/`k` to move.
- Press `enter` to select.
- Press `q`, `esc`, or `ctrl-c` to exit.

In non-interactive environments such as CI, pipes, or captured command output, Agent Flow prints a compact fallback view instead of taking over the terminal.

## Commands

```sh
agent-flow init [--codex] [--claude] [--agent codex|claude|all] [--force] [--force-memory]
agent-flow onboard [--refresh] [--dry-run] [--force]
agent-flow start <task> [--module name] [--limit n] [--budget-lines n] [--json] [--stats]
agent-flow close [--change "..."] [--decision "..."] [--error "..."] [--next "..."] [--module name] [--allow-duplicate]
agent-flow status
agent-flow doctor
agent-flow context <task> [--module name] [--limit n] [--budget-lines n] [--json] [--stats]
agent-flow memory list
agent-flow memory search <query> [--file events|modules|decisions|errors] [--type type] [--module name] [--limit n]
agent-flow memory query <query> [--module name] [--drawer name] [--type type] [--status status] [--limit n] [--json]
agent-flow memory inspect
agent-flow memory rebuild [--dry-run] [--json]
agent-flow memory context <query> [--limit n]
agent-flow memory validate
agent-flow memory append --file events --type event --summary "..." [--module name] [--files a,b] [--tags tag]
agent-flow plan init [--scaffold] [--force] [--json]
agent-flow plan validate [--json]
agent-flow plan show [--json]
agent-flow plan render [--json]
agent-flow next [--wave] [--peek] [--budget-lines n] [--json]
agent-flow gate [--task id] [--strict] [--json]
agent-flow advance [--task id] [--gate] [--strict] [--json]
agent-flow review emit --phase id [--json]
agent-flow review record --phase id --verdict pass|fail [--notes "..."] [--json]
```

## Orchestration

Agent Flow can drive a project as a deterministic state machine while keeping the
continuity layer. It never spawns agents itself — it emits envelopes and runs
gates; your agent does the work.

Every command targets the agent-flow project at the current directory, the
nearest ancestor project (so you can run from any subdirectory), or a path you
pass with the global `--root <dir>` flag (or the `AGENT_FLOW_ROOT` env var). Orchestration overhead stays near zero because
each step gets a scoped context pack instead of the whole repo.

The plan lives in `.agent-flow/plan.json` (canonical, committed). It groups work
into phases and tasks with requirements, waves, dependencies, gates, and
acceptance criteria. `.planning/ROADMAP.md` is a generated human view
(`agent-flow plan render`).

The loop:

```sh
agent-flow plan init            # seed .agent-flow/plan.json (author phases, or --scaffold)
agent-flow plan validate        # requirement coverage, dependency DAG, waves
agent-flow next                 # next task + acceptance + gates + a scoped context pack
# ... implement the task ...
agent-flow gate --task 1.1      # run the task's gates (tests/typecheck), cache the result
agent-flow advance --task 1.1   # marks done only if the gate is green; appends memory; moves on
```

Gates are configured in `.agent-flow/config.json` under `orchestration` and
resolved from detected package scripts by default. `advance` is a hard gate: it
refuses unless the gates are green for the current code (a worktree content
signature ties the cached result to the exact code).

There is a built-in **smoke** gate that boots the app and probes it over HTTP —
catching breakage that `inject`-style tests miss (e.g. a wrong start entrypoint).
Add `"smoke"` to a task's gates and configure it under `orchestration.smoke`:

```json
{
  "orchestration": {
    "smoke": {
      "start": "npm start",
      "env": { "PORT": "4999" },
      "baseUrl": "http://localhost:4999",
      "readyPath": "/",
      "probes": [
        { "name": "redirect", "method": "GET", "path": "/abc", "status": [301, 404] }
      ]
    }
  }
}
```

Tiered rigor (opt-in, set `orchestration.review.tier`):

- Tier 0 (default): deterministic gates only — zero added agent cost.
- Tier 1: closing a phase requires an independent review. `agent-flow review emit
  --phase N` prints a review envelope to hand to a separate reviewer; record the
  verdict with `agent-flow review record --phase N --verdict pass|fail`.
- Tier 2: `agent-flow next --wave` emits one envelope per parallelizable task in
  the next wave (scope-disjoint) so the host runtime can fan out.

### Domain hardening

Plans written without domain knowledge ship without domain hardening — the
acceptance criteria are the contract, and gates/reviews only enforce what the
contract says. Three layers close that hole, cheapest first:

1. **Pitfall packs (zero tokens).** Curated per-domain checklists built into the
   CLI (`http-api`, `persistence`, `auth-secrets`, `randomness`). When a task's
   scope/gates/wording match a pack, `plan validate` warns about table-stakes
   criteria the task is missing (atomic writes, body caps, redirect cache
   headers, crypto-grade randomness, ...). Waive a conscious omission per task:
   `"waives": ["http-api/redirect-cache"]` (or a whole pack: `"waives": ["http-api"]`).
2. **Reviewer expectations (zero extra cost).** Outstanding pack gaps are
   embedded in the tier-1 review envelope as hardening expectations, and the
   rubric makes missing table-stakes hardening a blocking finding unless waived.
3. **`plan harden` (one agent).** `agent-flow plan harden` prints a spawn-ready
   prompt for a single domain-hardening reviewer; pipe its JSON back with
   `agent-flow plan harden --apply --from-json -` to merge the proposed
   acceptance criteria into plan.json — where gates and review enforce them.

```sh
agent-flow plan harden | <spawn one agent> | agent-flow plan harden --apply --from-json -
agent-flow plan validate   # re-check coverage
```

## Available Skills

| Skill | Use it when |
| --- | --- |
| `flow-onboard` | You want Codex to add human-level context after `agent-flow onboard` creates the deterministic baseline. |
| `flow-resume` | You are starting a new session and want Codex to summarize current state, recent events, decisions, risks, and next actions. |
| `flow-quick` | You need a small, scoped code change with minimal diff. |
| `flow-plan` | You need to break larger work into phases with acceptance criteria. |
| `flow-verify` | You want Codex to inspect the diff, run available checks, and catch scope creep before handoff. |
| `flow-close` | You are ending a session and want to save durable project memory for next time. |

## How Memory Works

Agent Flow stores memory in plain files inside the repository.

Planning files live in `.planning/`:

- `PROJECT.md`
- `REQUIREMENTS.md`
- `ROADMAP.md`
- `STATE.md`
- `DECISIONS.md`
- `OPEN_QUESTIONS.md`

Append-only memory lives in `.memory/`:

- `events.jsonl`
- `decisions.jsonl`
- `errors.jsonl`
- `modules.jsonl`

Codex skills live in `.codex/skills/`.

All memory entries are JSONL objects with:

- `createdAt`
- `type`
- `summary`

Additional structured fields keep memory useful without adding semantic search:

- `events`: optional `module`, `files`, `tags`
- `modules`: required `module`, optional `files`, `tags`
- `decisions`: optional `module`, `status`, `rationale`, `alternatives`
- `errors`: optional `module`, `cause`, `solution`

Memory can be appended from the CLI. Entries are validated by target file and exact duplicates are rejected by default using file, type, module, and normalized summary:

```sh
agent-flow memory append --file events --type change --summary "Documented initial architecture" --module api --files src/api.ts --tags architecture
agent-flow memory append --file modules --type module --summary "API module owns HTTP routes" --module api --files src/api.ts
agent-flow memory append --file decisions --type decision --summary "Keep memory local JSONL" --status accepted --rationale "Simple, reviewable, and repo-local"
agent-flow memory append --file errors --type error --summary "Build failed on missing env validation" --cause "Required env var was unchecked" --solution "Validate env at startup"
```

Use `--allow-duplicate` only when repeating the same durable entry is intentional.

Search stays local and non-semantic:

```sh
agent-flow memory search "billing" --file events --type change --module billing --limit 5
agent-flow memory query "billing webhook" --module billing --limit 5
agent-flow memory context "billing"
```

`memory context` prints a compact deterministic context pack with relevant events, modules, decisions, errors, and suggested Codex usage.

## SQLite Memory Index

JSONL remains the reviewable source of truth. The SQLite database at `.agent-flow/memory.db` is an internal generated query index for faster structured lookup and better context packs.

No data leaves your machine. The index is auto-created, migrated, and synced from `.memory/*.jsonl` when query-producing commands need it:

```sh
agent-flow memory query "billing webhook"
agent-flow context "fix billing webhook"
```

`agent-flow memory inspect` and `agent-flow status` are read-only state reports. They do not create, sync, or rebuild `.agent-flow/memory.db`. If the index is stale, run `agent-flow memory rebuild` to recreate only the generated index.

You normally do not manage SQLite directly:

- `agent-flow memory search` is raw JSONL search.
- `agent-flow memory query` is indexed structured project memory query.
- `agent-flow context` is the project-aware context pack for coding agents.

Use `agent-flow memory inspect` to see index health and counts. Use `agent-flow memory rebuild` to recreate only the generated index. Rebuild never modifies `.memory/*.jsonl`.

## Context Packs

Context packs reduce token waste by turning local planning files, structured memory, and detected project commands into a compact task-focused brief. Instead of pasting all of `.planning/` and `.memory/`, ask for the context needed for the current task:

```sh
agent-flow context "fix billing webhook"
```

The command reads `.planning/STATE.md`, project planning notes, indexed structured memory, and detected package scripts. It scores entries locally with deterministic keyword matching, exact phrase boosts, module preference, memory type priority, status, and recency. It does not use embeddings, semantic search, MCP, or external services.

Example output:

```text
# Context Pack

Task:
fix billing webhook

Project Summary:
- Package manager: pnpm
- Stack: Next.js, Prisma
- Commands: dev=pnpm dev, build=pnpm build, test=pnpm test, typecheck=pnpm typecheck

Git Context:
- Branch: main
- Dirty: yes
- Last commit: a1b2c3d Add billing webhook handler

Current State:
- Billing checkout is working; webhook retry handling is still under review.

Relevant Modules:
- [billing] Billing module owns checkout, invoices, and webhook idempotency.

Relevant Decisions:
- [accepted] Keep webhook processing idempotent with provider event ids.

Relevant Errors:
- [billing] Duplicate Stripe webhook processing created duplicate credits.
  cause: Missing event id guard.
  solution: Store processed event ids before applying credits.

Verification Commands:
- pnpm test
- pnpm typecheck

Suggested Agent Usage:
- Use this context before running $flow-quick or $flow-plan.
- Treat it as a starting point; inspect referenced files before editing.
```

Use `agent-flow context "<task>"` before `$flow-quick`, before `$flow-plan`, and when resuming a specific task. Use `--module billing` to prefer one area, `--budget-lines 60` for a tighter paste, and `--json` for structured output. Events and open questions are included by default; `--include-events` and `--include-open-questions` are default-on compatibility flags.

Related commands:

- `agent-flow memory search` is for raw local JSONL lookup.
- `agent-flow memory query` is for indexed structured memory lookup.
- `agent-flow memory context` is a backward-compatible memory-only context helper.
- `agent-flow context` is the main project-aware context pack for agent work.

### Memory validation and migration notes

v0.3.0 validates memory schemas. Old or manually edited memory entries may fail if they are missing `createdAt`, `type`, `summary`, or `module` for entries in `modules.jsonl`.

Use this command to find exact file and line errors:

```sh
agent-flow memory validate
```

Fix invalid JSONL entries manually, or re-add durable entries using `agent-flow memory append` so the CLI writes the required fields. Validation never modifies memory files.

Existing files are protected by default. `--force` does not overwrite memory files; use `--force-memory` only when you explicitly want to reset memory.

Use `agent-flow onboard` for deterministic baseline context. Use `$flow-onboard` when you want Codex to enrich that baseline with judgment from reading the repo.

For `agent-flow onboard`, `--force` replaces generated onboarding sections only. It does not wipe custom content outside markers and does not wipe memory. `--refresh` appends a new onboarding event; existing module entries are not duplicated.

## Current Status / Roadmap

Current MVP:

- Interactive terminal dashboard with real actions
- First-run guided setup for uninitialized repos
- `agent-flow start <task>` with context pack and next-action guidance
- `agent-flow close` with interactive and non-interactive memory capture
- `agent-flow init --codex`
- `agent-flow onboard`
- `agent-flow status`
- `agent-flow doctor`
- `agent-flow context <task>` with `--stats` for token savings
- `agent-flow memory list`
- `agent-flow memory search <query>`
- `agent-flow memory query <query>`
- `agent-flow memory inspect`
- `agent-flow memory rebuild`
- `agent-flow memory context <query>`
- `agent-flow memory validate`
- `agent-flow memory append`
- Codex skills for onboarding, resume, quick work, planning, verification, and closeout
- File-based planning and memory

Near-term roadmap:

- Improve deterministic onboarding from real dogfooding feedback
- Improve project detection for more repo shapes
- Keep the Codex workflow small, safe, and predictable before adding more integrations

## Limitations

- `agent-flow onboard` creates baseline memory, but Codex may still need `$flow-onboard` for deeper project judgment.
- Memory uses JSONL as source plus an internal SQLite query index; there is no semantic search yet.
- Monorepos are not deeply understood yet.
- Detection is intentionally simple.
- No MCP, embeddings, or user-managed databases are included in this MVP.

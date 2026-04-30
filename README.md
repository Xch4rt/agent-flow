# Agent Flow

Agent Flow is a Codex-first workflow and memory layer for software projects.

> Never explain your repo twice.

## What It Is

Agent Flow helps Codex understand a repository once, save the useful context, and reuse it across future coding sessions.

It is not a generic agent framework. It is a small developer tool for project continuity: onboarding a repo, resuming context, planning work, verifying changes, and closing a session with useful memory.

## The Problem

AI coding sessions often start with the same manual explanation:

- What this repo does
- Which files matter
- How to run tests
- What was decided last time
- What is safe to change
- What still needs attention

Agent Flow turns that repeated explanation into repo-local planning files, memory entries, and Codex skills.

## Quick Start

Install from GitHub:

```sh
npm install -g github:Xch4rt/agent-flow
```

Or with pnpm:

```sh
pnpm add -g github:Xch4rt/agent-flow
```

Check the CLI:

```sh
agent-flow --help
```

For local development:

```sh
pnpm install
pnpm build
pnpm link --global
```

Initialize a project:

```sh
agent-flow init --codex
agent-flow onboard
```

Open Codex in the repository, then start with:

```text
$flow-resume
```

From then on, start future sessions with:

```text
$flow-resume
```

## Daily Workflow

Agent Flow is built around this loop:

```text
init -> onboard -> close -> resume -> work -> verify -> close
```

First-time setup:

1. Run `agent-flow init --codex`
2. Run `agent-flow onboard`
3. Open Codex in the repo
4. Run `$flow-resume`

Daily use:

1. Start with `$flow-resume`
2. Use `$flow-quick` for small scoped changes
3. Use `$flow-plan` for larger work
4. Use `$flow-verify` before commit or handoff
5. End with `$flow-close`

Useful CLI checks:

```sh
agent-flow status
agent-flow doctor
agent-flow memory list
agent-flow memory search "auth"
agent-flow memory context "auth"
agent-flow context "fix billing webhook"
```

## Commands

```sh
agent-flow init --codex [--force] [--force-memory]
agent-flow onboard [--refresh] [--dry-run] [--force]
agent-flow status
agent-flow doctor
agent-flow context <task> [--module name] [--limit n] [--budget-lines n] [--json]
agent-flow memory list
agent-flow memory search <query> [--file events|modules|decisions|errors] [--type type] [--module name] [--limit n]
agent-flow memory context <query> [--limit n]
agent-flow memory validate
agent-flow memory append --file events --type event --summary "..." [--module name] [--files a,b] [--tags tag]
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

Additional structured fields keep memory useful without adding databases or semantic search:

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
agent-flow memory context "billing"
```

`memory context` prints a compact deterministic context pack with relevant events, modules, decisions, errors, and suggested Codex usage.

## Context Packs

Context packs reduce token waste by turning local planning files, structured memory, and detected project commands into a compact task-focused brief. Instead of pasting all of `.planning/` and `.memory/`, ask for the context needed for the current task:

```sh
agent-flow context "fix billing webhook"
```

The command reads `.planning/STATE.md`, project planning notes, structured JSONL memory, and detected package scripts. It scores entries locally with deterministic keyword matching, exact phrase boosts, module preference, memory type priority, status, and recency. It does not use embeddings, semantic search, SQLite, MCP, or external services.

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
- `agent-flow memory context` is a memory-only context helper.
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

- `agent-flow init --codex`
- `agent-flow onboard`
- `agent-flow status`
- `agent-flow doctor`
- `agent-flow context <task>`
- `agent-flow memory list`
- `agent-flow memory search <query>`
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
- Memory is file-based and keyword-searchable; there is no semantic search yet.
- Monorepos are not deeply understood yet.
- Detection is intentionally simple.
- No MCP, embeddings, dashboards, databases, SQLite, or Claude adapter are included in this MVP.

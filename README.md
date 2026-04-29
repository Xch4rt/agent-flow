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
```

Open Codex in the repository, then run:

```text
$flow-onboard
$flow-close
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
2. Open Codex in the repo
3. Run `$flow-onboard`
4. Run `$flow-close`

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
```

## Available Skills

| Skill | Use it when |
| --- | --- |
| `flow-onboard` | You are setting up a repo for the first time and need Codex to inspect it, identify commands/modules/risks, and populate project memory. |
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

Memory can be appended from the CLI:

```sh
agent-flow memory append --file events --type event --summary "Documented initial architecture" --module api
```

Existing files are protected by default. `--force` does not overwrite memory files; use `--force-memory` only when you explicitly want to reset memory.

## Current Status / Roadmap

Current MVP:

- `agent-flow init --codex`
- `agent-flow status`
- `agent-flow doctor`
- `agent-flow memory list`
- `agent-flow memory search <query>`
- `agent-flow memory append`
- Codex skills for onboarding, resume, quick work, planning, verification, and closeout
- File-based planning and memory

Near-term roadmap:

- Improve status and doctor checks from real dogfooding feedback
- Improve project detection for more repo shapes
- Add stronger memory validation
- Keep the Codex workflow small, safe, and predictable before adding more integrations

## Limitations

- Codex must still run `$flow-onboard` once to create useful project memory.
- Memory is file-based and keyword-searchable; there is no semantic search yet.
- Monorepos are not deeply understood yet.
- Detection is intentionally simple.
- No MCP, embeddings, dashboards, databases, SQLite, or Claude adapter are included in this MVP.

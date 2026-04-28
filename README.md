# agent-flow

Codex-first workflow and memory for software project continuity.

> Never explain your repo twice.

`agent-flow` is a narrow CLI for helping AI coding agents onboard a repository, resume context, execute small tasks, plan larger work, verify changes, and close sessions with useful project memory.

## Install

```sh
pnpm install
pnpm build
pnpm link --global
```

For local development:

```sh
pnpm dev -- init --codex
```

## Daily Workflow

agent-flow is built around this lifecycle:

```text
init -> onboard -> close -> resume -> work -> verify -> close
```

### First-Time Setup

1. Initialize a repository once:

```sh
agent-flow init --codex
```

2. Open Codex in the repository.

3. Run the onboarding skill once:

```text
$flow-onboard
```

4. Save the initial project memory:

```text
$flow-close
```

### Daily Use

Start each future Codex session with:

```text
$flow-resume
```

Use the focused skills while working:

```text
$flow-quick
$flow-plan
$flow-verify
$flow-close
```

Run `$flow-quick` for small scoped changes, `$flow-plan` for larger work, `$flow-verify` before commit or handoff, and `$flow-close` when ending the session.

### When To Use Each Skill

| Skill | Use when |
| --- | --- |
| `flow-onboard` | First time in a repo, after `agent-flow init --codex`, to inspect the project and populate `.planning` and `.memory`. |
| `flow-resume` | Starting a normal session after onboarding, to recover current state, decisions, risks, and next actions. |
| `flow-quick` | Making a small scoped code change with minimal diff and focused verification. |
| `flow-plan` | Planning larger work that crosses modules, changes architecture, or needs acceptance criteria. |
| `flow-verify` | Reviewing the diff, running available checks, and catching scope creep before commit or handoff. |
| `flow-close` | Ending a session by updating `.planning/STATE.md` and appending durable memory entries. |

Check project continuity files from the terminal:

```sh
agent-flow status
agent-flow doctor
agent-flow memory list
agent-flow memory search "auth"
```

Append a memory entry from the terminal:

```sh
agent-flow memory append --file events --type event --summary "Documented initial architecture" --module api
```

## What Init Creates

`agent-flow init --codex` creates:

- `AGENTS.md`
- `.agent-flow/config.json`
- `.planning/PROJECT.md`
- `.planning/REQUIREMENTS.md`
- `.planning/ROADMAP.md`
- `.planning/STATE.md`
- `.planning/DECISIONS.md`
- `.planning/OPEN_QUESTIONS.md`
- `.memory/events.jsonl`
- `.memory/decisions.jsonl`
- `.memory/errors.jsonl`
- `.memory/modules.jsonl`
- `.codex/skills/flow-onboard/SKILL.md`
- `.codex/skills/flow-resume/SKILL.md`
- `.codex/skills/flow-quick/SKILL.md`
- `.codex/skills/flow-plan/SKILL.md`
- `.codex/skills/flow-verify/SKILL.md`
- `.codex/skills/flow-close/SKILL.md`

Existing files are not overwritten unless `--force` is provided. Memory JSONL files are preserved even with `--force`; use `--force-memory` only when you explicitly want to reset memory.

## Commands

```sh
agent-flow init --codex [--force] [--force-memory]
agent-flow status
agent-flow doctor
agent-flow memory list
agent-flow memory search <query>
agent-flow memory append --file events --type event --summary "..." [--module name]
```

## Scope

This MVP intentionally does not include MCP servers, embeddings, dashboards, databases, or non-Codex agent integrations.

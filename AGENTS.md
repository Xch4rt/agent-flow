# AGENTS.md

This repository is prepared for AI coding agents with agent-flow.

## Project Snapshot

- Package manager: pnpm
- Detected stack: Not detected yet

## Common Commands

- Install: pnpm install
- Dev: pnpm dev
- Build: pnpm build
- Test: pnpm test
- Lint: Not detected yet
- Typecheck: pnpm typecheck

## Agent Workflow

Skills are the same in both runtimes: `$flow-*` in Codex (`.agents/skills/`), `/flow-*` in Claude Code (`.claude/skills/`).

1. For a fresh repo, run `agent-flow init --codex` or `--claude`, then `agent-flow onboard`, then `flow-resume`.
2. Planned work: `flow-plan` authors `.agent-flow/plan.json`, `flow-harden` adds domain criteria, `flow-orchestrate` runs next → implement → gate → review → advance. `agent-flow advance` refuses to close work whose gates are not green for the current code.
3. Use `.planning/STATE.md` as the current project truth.
4. Use `.planning/DECISIONS.md` for durable technical decisions.
5. Use `.memory/*.jsonl` as the reviewable append-only memory log.
6. Treat `.agent-flow/memory.db` as an internal generated SQLite index. Do not manually edit it.
7. Prefer `agent-flow context <task>` for focused task context before non-trivial agent work.
8. Run noisy commands through `agent-flow run -- <command>`: only the failures reach your context.
9. Do not overwrite memory without explicit user instruction.
10. Prefer small scoped changes and avoid unrelated refactors.
11. Run detected verification commands before final response when possible.

## Memory Files

- `.memory/events.jsonl`: important repo events and session notes.
- `.memory/decisions.jsonl`: durable product or technical decisions.
- `.memory/errors.jsonl`: errors, causes, and fixes.
- `.memory/modules.jsonl`: notes about important files, modules, and ownership.

## Memory Index

- `.agent-flow/memory.db`: internal generated SQLite index for faster local queries and context packs.
- JSONL files remain the source of truth; rebuild the index with `agent-flow memory rebuild` if needed.
- Do not commit or manually edit `.agent-flow/memory.db`.

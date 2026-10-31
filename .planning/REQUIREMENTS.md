# Requirements

Milestone **v0.11 — evidence and tuning**: agent-flow runs on itself, its central
claims are backed by a published benchmark, the router can be judged from observed
usage, and onboarding understands more projects.

## Dogfooding

- **DOG-01**: This repository uses agent-flow for its own work: planning files, memory, skills for both runtimes and the plan are committed, and `agent-flow doctor` is green.
- **DOG-02**: Friction found while using agent-flow on itself is recorded as memory (events, errors) or open questions, not lost in chat.

## Benchmark

- **BENCH-01**: At least three bench tasks of distinct domains (HTTP API + persistence, a CLI, a refactor of existing code), each with a seed repo, a task prompt and hidden acceptance tests.
- **BENCH-02**: Published results in `docs/bench-results.md`: medians per task for `plain`, `gsd` and `agent-flow`, in Claude Code and Codex, with pass rate, tokens (input-eq), cache reads, peak context and wall time, plus the exact commands to reproduce them.

## Router feedback

- **ROUTER-01**: A per-tier report (from `usage` and `.agent-flow/task-stats.json`): tasks routed, first-attempt gate pass rate, escalations, and median tokens per task, for the current project or `--all`.
- **ROUTER-02**: The report flags an optimistic router (light/standard tasks that escalated) or a pessimistic one (deep tasks green on the first attempt) and suggests a threshold change; it never applies it.

## Project detection

- **DETECT-01**: Node and TypeScript projects without a known framework are detected as such (language, TypeScript, test runner: vitest / jest / node:test, lint and typecheck commands) instead of "none".
- **DETECT-02**: Python (pyproject / requirements), Go (go.mod) and Rust (Cargo.toml) projects are detected with their test, lint and build commands.
- **DETECT-03**: Monorepo workspaces (pnpm-workspace, npm/yarn workspaces, turbo) are listed as packages with their own commands in PROJECT.md and the context pack.

## Non-Goals

- Semantic search or embeddings: scoring stays deterministic and local.
- Automatic router tuning: ROUTER-02 reports and suggests only.
- New pitfall packs, symbol maps in envelopes and transcript-format contract tests: planned for v0.12.

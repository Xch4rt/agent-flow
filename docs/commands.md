# Command Reference

## Setup & status

```sh
agent-flow init [--codex] [--claude] [--agent codex|claude|all|none] [--force] [--force-memory]
agent-flow onboard [--refresh] [--dry-run] [--force]
agent-flow status
agent-flow doctor
agent-flow                       # interactive dashboard (compact fallback in CI/pipes)
```

`init` with no adapter flag asks which runtime to set up (Codex, Claude Code, both, or base files only) when run in a terminal, defaulting to the runtimes found on this machine (`~/.codex` / `$CODEX_HOME`, `~/.claude` / `$CLAUDE_CONFIG_DIR`); without a terminal (CI, pipes) it installs the detected ones and says so. `--agent none` writes only the base files.

## Orchestration

```sh
agent-flow plan init [--scaffold] [--force] [--json]
agent-flow plan validate [--json]
agent-flow plan show [--agent codex|claude] [--json]
agent-flow plan render [--json]
agent-flow plan harden [--apply --from-json <file|->] [--json]
agent-flow next [--wave] [--peek] [--task id] [--brief] [--budget-lines n] [--agent codex|claude] [--json]
agent-flow gate [--task id] [--strict] [--no-record] [--agent codex|claude] [--json]
agent-flow advance [--task id] [--gate] [--strict] [--json]
agent-flow review emit --phase id [--reviewer] [--json]
agent-flow review record --phase id [--verdict pass|fail] [--from-json <file|->] [--notes "..."] [--json]
```

All orchestration commands accept the global `--root <dir>` (or `AGENT_FLOW_ROOT`) to target a project from anywhere; by default they find the nearest ancestor project.

`--agent` picks whose agent names and model slugs `next`, `gate` and `plan show` print (Claude Code subagents `flow-executor*` on haiku/sonnet/opus, or Codex roles `flow_executor*` on gpt-6-*). Default: the only installed adapter, Claude when both are; `AGENT_FLOW_AGENT` overrides the default. The Codex skills always pass `--agent codex`.

## Context & sessions

```sh
agent-flow start <task> [--module name] [--limit n] [--budget-lines n] [--json] [--stats]
agent-flow context <task> [--module name] [--limit n] [--budget-lines n] [--json] [--stats]
agent-flow close [--change "..."] [--decision "..."] [--error "..."] [--next "..."] [--module name] [--allow-duplicate]
```

## Token tools

```sh
agent-flow run [--max-failures n] [--json] -- <command...>   # only the failures; full log in .agent-flow/logs/
agent-flow guard prompt|tool                                  # Claude Code / Codex hook entrypoint (reads hook JSON on stdin)
agent-flow doctor --tokens                                    # token hygiene checks + last-7d signals
agent-flow bench prepare <task-dir> --variant <name> [--dir <path>] [--json]
agent-flow bench finish <run-dir> [--agent codex|claude] [--json]
agent-flow bench report [--dir <path>] [--task <name>] [--out <file>] [--json]
```

- **`run`** parses vitest, jest, node:test, tsc, eslint and pytest output into `file:line — reason` failures (generic tail otherwise), prints one line on success, propagates the exit code, and keeps the last 30 full logs. Gates use the same parsers.
- **`guard`** is installed by `init --claude` and `init --codex`. Claude Code: a `UserPromptSubmit` hook in `.claude/settings.json` (merged, never replaced) and a `PreToolUse` hook in the executor subagents' frontmatter. Codex: both hooks in `.codex/hooks.json` (merged; Codex runs project hooks only in trusted projects and asks you to trust each hook once in `/hooks`); the `PreToolUse` hook runs for every tool call but only acts inside `flow_executor*` roles, whose own rollout it finds by the `agent_id` in the hook input. The prompt hook warns when you return to a big session after its prompt cache expired, or when a session passes `guard.sessionBudgetTokens`; the tool hook denies executor tool calls past `orchestration.contextBudgetTokens` (except writing the handoff). Hook commands no-op if `agent-flow` is not on PATH. Config (`.agent-flow/config.json`): `guard.enabled`, `guard.sessionBudgetTokens` (200k), `guard.idleMinutes` (5), `guard.minContextTokens` (100k), `guard.blockColdResume` (false — true blocks the first cold prompt once; re-send to continue), `guard.enforceExecutors` (true).
- **`bench`**: see [bench/tasks/README.md](../bench/tasks/README.md). Workspaces live in `~/.agent-flow-bench` (or `$AGENT_FLOW_BENCH_DIR`) so each run's transcripts — and tokens — are isolated by path; hidden acceptance tests are copied in only at `finish`. Runs made with Codex are measured with `finish --agent codex`.

## Usage (observed tokens)

```sh
agent-flow usage [--agent claude|codex] [--all] [--since 7d|12h|90m|<iso>] [--session <id-prefix>] [--top n] [--idle-minutes n] [--dir <config-dir>] [--json]
```

Reads Claude Code transcripts (`$CLAUDE_CONFIG_DIR` or `~/.claude`, under `projects/<project-slug>/`) or, with `--agent codex`, Codex rollouts (`$CODEX_HOME` or `~/.codex`, under `sessions/YYYY/MM/DD/rollout-*.jsonl`, matched to the project by their recorded `cwd`; spawned subagents are separate rollouts linked by `parent_thread_id`), and reports what the API actually billed per request: input, cache writes, cache reads and output; main thread vs subagents; per project; per model; per skill (`/flow-*` or `$flow-*`); subagents by type (with requests per agent, peak context and `SendMessage` / `followup_task` continuations) and the heaviest individual subagents; peak context per session; and large cold re-reads classified as *after idle gap* (cache expired while away), *prefix changed* (compaction, model switch, edited CLAUDE.md or AGENTS.md/tools) or *first request*. `--all` scans every project. The `input-eq` column folds the four kinds using API price ratios as a ranking aid — Claude 1 / 1.25 / 0.1 / 5; OpenAI has no cache-write surcharge, so for Codex `input` means uncached input and the ratios are 1 / 1 / 0.1 / 8 — it is not your plan's limit. Rollouts older than ~7 days may be zstd-compressed; reading them needs Node ≥ 22.15.

Unlike `context --stats` (a chars/4 estimate of one pack), `usage` measures whole sessions, including history, tool output, file reads and subagents.

## Memory

```sh
agent-flow memory list
agent-flow memory search <query> [--file events|modules|decisions|errors] [--type type] [--module name] [--limit n]
agent-flow memory query <query> [--module name] [--drawer name] [--type type] [--status status] [--limit n] [--json]
agent-flow memory context <query> [--limit n]
agent-flow memory inspect
agent-flow memory rebuild [--dry-run] [--json]
agent-flow memory validate
agent-flow memory append --file <events|modules|decisions|errors> --type <type> --summary "..." [--module name] [--files a,b] [--tags tag] [--status s] [--rationale "..."] [--cause "..."] [--solution "..."] [--allow-duplicate]
```

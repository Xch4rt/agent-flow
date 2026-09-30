# Command Reference

## Setup & status

```sh
agent-flow init [--codex] [--claude] [--agent codex|claude|all] [--force] [--force-memory]
agent-flow onboard [--refresh] [--dry-run] [--force]
agent-flow status
agent-flow doctor
agent-flow                       # interactive dashboard (compact fallback in CI/pipes)
```

## Orchestration

```sh
agent-flow plan init [--scaffold] [--force] [--json]
agent-flow plan validate [--json]
agent-flow plan show [--json]
agent-flow plan render [--json]
agent-flow plan harden [--apply --from-json <file|->] [--json]
agent-flow next [--wave] [--peek] [--task id] [--brief] [--budget-lines n] [--json]
agent-flow gate [--task id] [--strict] [--json]
agent-flow advance [--task id] [--gate] [--strict] [--json]
agent-flow review emit --phase id [--reviewer] [--json]
agent-flow review record --phase id [--verdict pass|fail] [--from-json <file|->] [--notes "..."] [--json]
```

All orchestration commands accept the global `--root <dir>` (or `AGENT_FLOW_ROOT`) to target a project from anywhere; by default they find the nearest ancestor project.

## Context & sessions

```sh
agent-flow start <task> [--module name] [--limit n] [--budget-lines n] [--json] [--stats]
agent-flow context <task> [--module name] [--limit n] [--budget-lines n] [--json] [--stats]
agent-flow close [--change "..."] [--decision "..."] [--error "..."] [--next "..."] [--module name] [--allow-duplicate]
```

## Usage (observed tokens)

```sh
agent-flow usage [--all] [--since 7d|12h|90m|<iso>] [--session <id-prefix>] [--top n] [--idle-minutes n] [--dir <claude-config-dir>] [--json]
```

Reads Claude Code transcripts (`$CLAUDE_CONFIG_DIR` or `~/.claude`, under `projects/<project-slug>/`) and reports what the API actually billed per request: input, cache writes, cache reads and output; main thread vs subagents; per project; per model; per skill/slash command; subagents by type (with requests per agent, peak context and `SendMessage` continuations) and the heaviest individual subagents; peak context per session; and large cache writes classified as *after idle gap* (cache expired while away), *prefix changed* (compaction, model switch, edited CLAUDE.md/tools) or *first request*. `--all` scans every project. The `input-eq` column folds the four kinds using API price ratios (1 / 1.25 / 0.1 / 5) as a ranking aid — it is not your plan's limit.

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

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
agent-flow next [--wave] [--peek] [--budget-lines n] [--json]
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

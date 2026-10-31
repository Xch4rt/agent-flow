@AGENTS.md

## Claude Code

Use Agent Flow for project continuity and orchestrated execution.

Daily loop for planned work (`.agent-flow/plan.json`):

- `/flow-plan <feature>` — break work into phases/tasks with acceptance criteria
- `/flow-harden` — one-agent hardening pass merges domain pitfalls into the plan
- `/flow-orchestrate` — execute the loop: next → implement → gate → review → advance

Quick work and continuity:

- `/flow-quick <small task>` — narrow change, minimal diff
- `agent-flow context "<task>"` — focused context pack (prefer it over reading all `.planning/` and `.memory/` manually)
- `/flow-close` — record durable memory at the end of meaningful work

The gates are the gates: `agent-flow advance` refuses to close work whose gates or reviews are not green for the current code. Do not work around it.

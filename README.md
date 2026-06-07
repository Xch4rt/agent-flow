# Agent Flow

Local workflow and memory layer for AI coding agents — Claude Code and Codex.

> Never explain your repo twice. Never trust "done" without green gates.

![agent-flow quickstart](demo/out/quickstart.gif)

```sh
npm install -g @xch4rt/agent-flow
agent-flow init --claude     # or --codex, or --agent all
```

Then, inside Claude Code:

```text
/flow-plan <feature>     break work into phases/tasks with acceptance criteria
/flow-harden             one agent turns domain pitfalls into enforceable criteria
/flow-orchestrate        execute: next → implement → gate → review → advance
```

Agent Flow emits the envelopes and runs the gates; your agent does the work; `advance` refuses to close anything that isn't proven.

## Why

- **Agents forget your repo.** Agent Flow keeps planning files and append-only memory in the repo, and serves task-focused context packs — no re-explaining, no pasting the whole codebase.
- **Agents say "done" too easily.** A committed plan with acceptance criteria, deterministic gates (tests, typecheck, a real boot-and-probe smoke gate), and independent phase reviews make "done" mean something.
- **Plans miss what experts know.** Pitfall packs flag missing table-stakes criteria for free; one hardening agent fills the rest. Benchmark: matched a research-heavy multi-agent pipeline's quality at **24% of its tokens**.

Everything is local files in your repo. No server, no embeddings, no external services.

## The daily loop

```sh
agent-flow next                 # next task + acceptance + gates + scoped context pack
# ... your agent implements ...
agent-flow gate --task 1.1      # run the task's gates
agent-flow advance --task 1.1   # closes only if gates are green for the current code
```

![the daily loop: gate, refuse, review, advance](demo/out/daily-loop.gif)

Closing a phase can require an **independent review** (tier 1): `review emit --reviewer` prints a spawn-ready prompt; `review record --from-json -` ingests the reviewer's JSON verdict. Scope-disjoint tasks fan out in parallel with `next --wave` (tier 2).

### Hardening

```sh
agent-flow plan validate   # pitfall packs flag missing table-stakes criteria — zero tokens
agent-flow plan harden | <one agent> | agent-flow plan harden --apply --from-json -
```

![domain hardening: packs flag the gaps, one agent fills them](demo/out/harden.gif)

→ Full details: **[docs/orchestration.md](docs/orchestration.md)**

## Skills

Installed by `agent-flow init --claude` (`.claude/skills/`) and `init --codex` (`.codex/skills/`):

| Skill | Use it when |
| --- | --- |
| `/flow-plan` | Break larger work into phases/tasks and author `.agent-flow/plan.json` |
| `/flow-harden` | Run the hardening pass before executing a plan |
| `/flow-orchestrate` | Drive the loop: next → implement → gate → review → advance |
| `/flow-quick` | Small scoped change, minimal diff |
| `/flow-verify` | Inspect the diff, run checks, catch scope creep before handoff |
| `/flow-onboard` / `/flow-resume` / `/flow-close` | First contact, session start, session end |

Codex currently ships the continuity skills (`$flow-*`); the orchestration loop skills are Claude Code-first (Codex parity is on the roadmap).

## Memory & context packs

```sh
agent-flow context "fix billing webhook"   # task-focused brief instead of the whole repo
agent-flow close                           # record durable memory at session end
```

Planning lives in `.planning/`, append-only memory in `.memory/*.jsonl` (reviewable source of truth), with a generated SQLite index for fast queries. Deterministic local scoring — no embeddings.

→ Full details: **[docs/memory.md](docs/memory.md)** · All flags: **[docs/commands.md](docs/commands.md)**

## Status

Current (v0.8.x): orchestration loop (plan/next/gate/advance, tiered reviews, wave fan-out, smoke gate), domain hardening (packs + `plan harden`), Claude Code skills for the full loop, deterministic onboarding, indexed context packs, terminal dashboard.

Roadmap: orchestration skills for Codex · more pitfall packs (frontend/XSS, SQL, CLI, concurrency) · goal-backward phase verification · better monorepo detection.

Known limits: no semantic search (deterministic scoring only) · monorepos not deeply understood · detection intentionally simple.

## Demos

Reproducible VHS recordings (tapes + fixtures + voiceover scripts) live in [`demo/`](demo/).

## License

MIT

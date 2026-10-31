# Agent Flow

Local workflow, memory and token discipline for AI coding agents — Claude Code and Codex.

> Never explain your repo twice. Never trust "done" without green gates. Never pay to re-read what you don't need.

![agent-flow quickstart](demo/out/quickstart.gif)

```sh
npm install -g @xch4rt/agent-flow
agent-flow init              # asks: Codex, Claude Code or both (or pass --codex / --claude / --agent all)
agent-flow onboard           # deterministic baseline of the repo → .planning/ + .memory/ (the skills resume from it)
agent-flow doctor            # files, hooks, onboarding — add --tokens for token hygiene
```

Then, inside Claude Code (`/flow-*`) or Codex (`$flow-*`):

```text
/flow-plan <feature>     break work into phases/tasks with acceptance criteria
/flow-harden             one agent turns domain pitfalls into enforceable criteria
/flow-orchestrate        execute: next → implement → gate → review → advance
/flow-quick <change>     small scoped change, minimal diff
```

Agent Flow emits the envelopes and runs the gates; your agent does the work; `advance` refuses to close anything that isn't proven.

## Why

- **Agents forget your repo.** Planning files and append-only memory live in the repo; task-focused context packs replace re-explaining or pasting the codebase.
- **Agents say "done" too easily.** A committed plan with acceptance criteria, deterministic gates (tests, typecheck, a boot-and-probe smoke gate) and independent phase reviews make "done" mean something.
- **Plans miss what experts know.** Pitfall packs flag missing table-stakes criteria for free; one hardening agent fills the rest — it matched a research-heavy multi-agent pipeline's quality at **24% of its tokens**.
- **Agents burn tokens on the wrong things.** Most spend is context re-read on every turn, prompt caches expiring between turns, and long-lived subagents. Agent Flow measures that and designs around it (below).

Everything is local files in your repo. No server, no embeddings, no external services.

## Spend fewer tokens, keep the quality

Quality is decided by gates and review; Agent Flow decides what it costs.

| | What it does |
| --- | --- |
| **Thin orchestrator** | `/flow-orchestrate` dispatches one fresh executor per task, passes files instead of contents, and stops at phase boundaries — the main thread never balloons. |
| **Zero-token router** | Each task is scored from the plan (scope, criteria, domain packs, risky wording) into `light` (haiku/low), `standard` (sonnet/medium) or `deep` (sonnet/high). Opus only after gates keep failing. `plan show` previews every route. |
| **Session guard** | Claude Code and Codex hooks warn when you return to a big session after its prompt cache expired, or when it passes its budget; executors past their budget must hand off. |
| **Compact output** | `agent-flow run -- pnpm test` prints only `file:line — reason` failures (vitest, jest, node:test, tsc, eslint, pytest); the full log stays on disk. Gates use it too. |
| **Observed usage** | `agent-flow usage` reads Claude Code transcripts or Codex rollouts (`--agent codex`): cached vs uncached input, peak context, cold-cache rewrites, main thread vs subagents, per model, per skill, per project. |
| **Benchmarks** | `agent-flow bench` runs the same task under different workflows (plain, GSD, Agent Flow) with hidden acceptance tests and reports tokens, pass rate and time. |

```sh
agent-flow usage --all --since 7d     # where did this week's tokens go?
agent-flow run -- pnpm test           # failures only, full log in .agent-flow/logs/
agent-flow plan show                  # progress + each task's routed tier
```

→ Full details: **[docs/orchestration.md](docs/orchestration.md)** · **[docs/commands.md](docs/commands.md)**

## The daily loop

```sh
agent-flow next                 # next task + acceptance + gates + scoped context pack
# ... your agent implements ...
agent-flow gate --task 1.1      # run the task's gates — red prints file:line failures and the executor to retry on
agent-flow advance --task 1.1   # closes only if gates are green for the current code
git commit ...                  # commit AFTER advance: the gate result is keyed to the working tree
```

![the daily loop: red gate, fix, refuse, review, advance, commit](demo/out/daily-loop.gif)

`agent-flow` with no arguments opens the terminal dashboard; `agent-flow plan show` prints progress and each task's routed tier.

Closing a phase can require an **independent review** (tier 1): `review emit --reviewer` prints a spawn-ready prompt; `review record --from-json -` ingests the reviewer's JSON verdict. Scope-disjoint tasks fan out in parallel with `next --wave` (tier 2).

### Hardening

```sh
agent-flow plan validate   # pitfall packs flag missing table-stakes criteria — zero tokens
agent-flow plan harden | <one agent> | agent-flow plan harden --apply --from-json -
```

![domain hardening: packs flag the gaps, one agent fills them](demo/out/harden.gif)

Hardening criteria feed the router too: `plan show` after a hardening pass typically moves the affected tasks to the deep tier.

## Skills and agents

Installed by `agent-flow init --claude` (`.claude/`) and `init --codex` (`.agents/skills/` + `.codex/`):

| Skill | Use it when |
| --- | --- |
| `/flow-plan` | Break larger work into phases/tasks and author `.agent-flow/plan.json` |
| `/flow-harden` | Run the hardening pass before executing a plan |
| `/flow-orchestrate` | Drive the loop: next → implement → gate → review → advance |
| `/flow-quick` | Small scoped change, minimal diff |
| `/flow-verify` | Inspect the diff, run checks, catch scope creep before handoff |
| `/flow-onboard` / `/flow-resume` / `/flow-close` | First contact (on top of `agent-flow onboard` — resume refuses until it has run), session start, session end |

Both runtimes get the same role agents with explicit model and effort — executors per tier, a reviewer and a hardener — and the session guard hooks, merged without touching your settings:

- **Claude Code**: `.claude/agents/flow-executor{-light,,-deep}.md`, `flow-reviewer.md`, `flow-hardener.md`; hook in `.claude/settings.json`. Models in `orchestration.tiers` / `orchestration.models` (haiku / sonnet / opus by default).
- **Codex**: custom agent roles `.codex/agents/flow_executor{_light,,_deep}.toml`, `flow_reviewer.toml`, `flow_hardener.toml`; hooks in `.codex/hooks.json` (trust them once with `/hooks`). Models in `orchestration.codex.tiers` / `orchestration.codex.models` (gpt-6-luna / gpt-6.1-sol / gpt-6-astra by default, efforts up to `ultra`). `$flow-orchestrate` spawns them with `spawn_agent` and `fork_turns: none`, so each executor starts from its envelope, not from the thread's history.

## Memory & context packs

```sh
agent-flow context "fix billing webhook"   # task-focused brief instead of the whole repo
agent-flow close                           # record durable memory at session end
```

Planning lives in `.planning/`, append-only memory in `.memory/*.jsonl` (reviewable source of truth), with a generated SQLite index for fast queries. Deterministic local scoring — no embeddings.

→ Full details: **[docs/memory.md](docs/memory.md)**

## Upgrading from 0.9

```sh
npm install -g @xch4rt/agent-flow@latest
agent-flow init --claude --force   # regenerates skills, agents and CLAUDE.md — review the diff if you customized them
agent-flow init --codex --force    # skills now live in .agents/skills/ (+ .codex/agents, .codex/hooks.json)
rm -r .codex/skills/flow-*         # 0.9 location, deprecated by Codex — doctor flags leftovers
agent-flow doctor --tokens
```

If `npm install -g` fails with `EACCES`, install Node with a version manager (nvm, fnm, volta) or set a user-level npm prefix instead of using `sudo`.

## Status

Current (v0.10.x): Claude Code and Codex at parity — the full loop as skills in both, role agents with explicit models, session guard hooks, observed usage from transcripts and rollouts — on top of token-aware orchestration (thin dispatcher, deterministic router, tiered executors, escalation by evidence), compact tool output, benchmarks, the orchestration loop (plan/next/gate/advance, tiered reviews, wave fan-out, smoke gate), domain hardening, deterministic onboarding (`agent-flow onboard`), indexed context packs and the terminal dashboard (`agent-flow` with no arguments).

Roadmap: published bench results vs GSD (both runtimes) · more bench tasks · symbol maps in task envelopes · more pitfall packs (frontend/XSS, SQL, CLI, concurrency).

Known limits: no semantic search (deterministic scoring only) · monorepos not deeply understood · the guard relies on Claude Code / Codex hook inputs and transcript formats that may change between versions (it degrades to doing nothing).

## Demos

Reproducible VHS recordings (tapes + fixtures + voiceover scripts) live in [`demo/`](demo/). Bench tasks live in [`bench/tasks/`](bench/tasks/).

## License

MIT

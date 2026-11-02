# Orchestration

Agent Flow drives a project as a deterministic state machine. It never spawns agents itself — it emits envelopes and runs gates; your agent does the work.

## The plan

The plan lives in `.agent-flow/plan.json` (canonical, committed). It groups work into phases and tasks with requirements, waves, dependencies, gates, and acceptance criteria. `.planning/ROADMAP.md` is a generated human view (`agent-flow plan render`).

```sh
agent-flow plan init --scaffold   # seed phases from REQUIREMENTS.md ids (CAT-01 format)
agent-flow plan validate          # structure, requirement coverage, dependency DAG, hardening
```

Every command targets the project at the current directory, the nearest ancestor project, or a path passed with `--root <dir>` (or `AGENT_FLOW_ROOT`).

## The loop

```sh
agent-flow next                 # next task + acceptance + gates + a scoped context pack
# ... implement the task ...
agent-flow gate --task 1.1      # run the task's gates, cache the result
agent-flow advance --task 1.1   # done only if gates are green; appends memory; moves on
git commit ...                  # commit AFTER advance: the gate result is keyed to the working tree
```

`advance` is a hard gate: it refuses unless the gates are green for the current code — a worktree content signature ties the cached result to the exact code. Re-running `gate` after any edit is mandatory by construction.

Orchestration overhead stays near zero: each step gets a scoped context pack instead of the whole repo.

## Token-aware orchestration

Quality is decided by gates and independent review; routing decides what it costs. `/flow-orchestrate` is a thin dispatcher:

- `agent-flow next --brief` prints a one-line dispatch record (task id, title, executor model). The orchestrator never loads the full envelope, code, or diffs.
- Each task runs in a **fresh `flow-executor` subagent** that fetches its own envelope (`agent-flow next --task <id> --json`), works inside its scope until `agent-flow gate` is green, and returns a ≤5-line status. Retries spawn a fresh executor with the gate tail or handoff — never a revived one (a revived agent re-reads its whole history, and after ~5 idle minutes re-writes it to the prompt cache at full price).
- Reviewer and hardener prompts and answers travel through files (`review emit ... > .agent-flow/review-<N>.prompt.md`), not through the orchestrator's conversation.
- The loop stops at phase boundaries and recommends `/clear`; state lives in `plan.json`.

**Deterministic router (zero tokens).** Before a task runs, agent-flow scores it from signals the plan already carries — scope size, number of acceptance criteria, hardening (`H<n>`) criteria, matching pitfall packs (auth/secrets and persistence weigh most), a smoke gate, dependencies, and risky wording (migration, schema, concurrency, auth, payment, crypto, …). The score picks a tier; each tier is an executor subagent with its own model and effort:

| Tier | Agent | Default model / effort | Typical task |
| --- | --- | --- | --- |
| light | `flow-executor-light` | haiku / low | one file, plain change |
| standard | `flow-executor` | sonnet / medium | typical feature work |
| deep | `flow-executor-deep` | sonnet / high | auth, persistence, many files, risky wording |

`agent-flow plan show` previews every pending task's route; `next --brief` returns the agent and model to spawn; `next --json` includes the scoring reasons. Pin a tier on a task with `"tier": "deep"` in `plan.json`, or turn routing off with `orchestration.router.enabled: false` (every task then uses the standard tier). The idea is the same as per-request effort routers such as Jev, but decided per task from the plan — no proxy, no extra model call, and the prompt cache is never touched.

**Escalation by evidence.** Every orchestrator `gate` run is recorded per task in `.agent-flow/task-stats.json` (executors iterate with `gate --no-record`, so their own fix-and-retry cycles do not count). Every `escalateAfterFailures` consecutive red attempts (default 2) the task climbs one rung: light → standard → deep → the `escalation` model (opus) on the deep agent. A green run resets it; `0` disables escalation.

`init --claude` installs the subagents in `.claude/agents/` (`flow-executor-light`, `flow-executor`, `flow-executor-deep`, `flow-reviewer`, `flow-hardener`) from `.agent-flow/config.json`:

```json
{
  "orchestration": {
    "router": { "enabled": true, "thresholds": { "standard": 2, "deep": 5 } },
    "tiers": {
      "light": { "model": "haiku", "effort": "low" },
      "standard": { "model": "sonnet", "effort": "medium" },
      "deep": { "model": "sonnet", "effort": "high" }
    },
    "models": { "reviewer": "sonnet", "hardener": "sonnet", "escalation": "opus" },
    "escalateAfterFailures": 2,
    "contextBudgetTokens": 150000
  }
}
```

`contextBudgetTokens` is the advisory budget past which an executor writes `.agent-flow/handoffs/<id>.md` and hands off instead of growing its context.

Re-run `agent-flow init --claude --force` after changing models so the agent files pick them up. Measure the effect with `agent-flow usage --since 1d`.

### Codex

The same loop runs in Codex (CLI ≥ 0.160 and the ChatGPT desktop app). `init --codex` installs:

- the eight skills in `.agents/skills/<name>/SKILL.md` (Codex's repo skill location; each with an `agents/openai.yaml` for the desktop app), invoked as `$flow-plan`, `$flow-harden`, `$flow-orchestrate`, …;
- custom agent roles in `.codex/agents/`: `flow_executor_light.toml`, `flow_executor.toml`, `flow_executor_deep.toml`, `flow_reviewer.toml`, `flow_hardener.toml` — each with `model`, `model_reasoning_effort` and `developer_instructions` (role names must be lowercase with underscores);
- the guard hooks in `.codex/hooks.json`.

Roles and models come from the `orchestration.codex` block (router thresholds, escalation cadence and the context budget are shared with Claude):

```json
{
  "orchestration": {
    "codex": {
      "tiers": {
        "light": { "model": "gpt-6-luna", "effort": "low" },
        "standard": { "model": "gpt-6.1-sol", "effort": "medium" },
        "deep": { "model": "gpt-6.1-sol", "effort": "high" }
      },
      "models": { "reviewer": "gpt-6.1-sol", "hardener": "gpt-6.1-sol", "escalation": "gpt-6-astra" }
    }
  }
}
```

Codex efforts go up to `ultra` (`low`, `medium`, `high`, `xhigh`, `max`, `ultra`; availability depends on the model). `$flow-orchestrate` asks `agent-flow next --brief --agent codex` for the role and model, then spawns it with `spawn_agent` (`agent_type`, `model`, `reasoning_effort`, `fork_turns: none` so the executor starts from its envelope rather than inheriting the thread), and never revives a finished agent with `followup_task` for a retry. `plan show --agent codex` previews the Codex route of every pending task. Codex loads `.codex/` config, roles and hooks only for trusted projects, and each hook must be trusted once in `/hooks`; `agent-flow doctor` checks the files and flags skills left in the deprecated `.codex/skills/` location.

## Gates

Gates are configured in `.agent-flow/config.json` under `orchestration.gates` and resolved from detected package scripts by default (`test`, `typecheck`, ...).

### The smoke gate

A built-in gate that boots the app and probes it over real HTTP — catching breakage that inject-style tests miss (e.g. a wrong start entrypoint). Add `"smoke"` to a task's gates and configure it under `orchestration.smoke`:

```json
{
  "orchestration": {
    "smoke": {
      "start": "npm start",
      "env": { "PORT": "4999" },
      "baseUrl": "http://localhost:4999",
      "readyPath": "/healthz",
      "probes": [
        { "name": "create", "method": "POST", "path": "/shorten",
          "body": "{\"url\":\"https://example.com\"}", "status": [201] },
        { "name": "missing", "method": "GET", "path": "/zzzzzz", "status": [404] },
        { "name": "redirect", "method": "GET", "path": "/abc",
          "status": [301], "headerIncludes": { "cache-control": "no-store" } }
      ]
    }
  }
}
```

Probes support `method`, `body` (content-type defaults to `application/json`), `headers`, accepted `status` list, and `headerIncludes` assertions.

## Tiered rigor

Opt-in via `orchestration.review.tier`:

- **Tier 0** (default): deterministic gates only — zero added agent cost.
- **Tier 1**: closing a phase requires an independent review. `agent-flow review emit --phase N --reviewer` prints a spawn-ready prompt for a separate reviewer agent; record its raw JSON answer with `agent-flow review record --phase N --from-json -` (prose around the JSON is tolerated). `advance` refuses to close the phase without a passing verdict keyed to the current code.
- **Tier 2**: `agent-flow next --wave` emits one envelope per parallelizable task in the next wave (scope-disjoint) so the host runtime can fan out executors.

## Domain hardening

Plans written without domain knowledge ship without domain hardening — acceptance criteria are the contract, and gates/reviews only enforce the contract. Three layers close that hole, cheapest first:

1. **Pitfall packs (zero tokens).** Curated per-domain checklists built into the CLI (`http-api`, `persistence`, `auth-secrets`, `randomness`). When a task's scope/gates/wording match a pack, `plan validate` warns about table-stakes criteria the task is missing (atomic writes, body caps, redirect cache headers, crypto-grade randomness, ...).
2. **Reviewer expectations (zero extra cost).** Outstanding pack gaps ride the tier-1 review envelope as hardening expectations, and the rubric makes missing table-stakes hardening a blocking finding unless waived.
3. **`plan harden` (one agent).**

   ```sh
   agent-flow plan harden | <spawn one agent> | agent-flow plan harden --apply --from-json -
   agent-flow plan validate
   ```

   The agent proposes missing acceptance criteria as JSON; `--apply` merges them into plan.json with fresh `H<n>` ids — where gates and review enforce them.

### Waivers

A conscious omission is declared per task, per criterion or per pack:

```json
"waives": ["http-api/redirect-cache", "persistence"]
```

Typical use: a server task waives `persistence` because the store module owns those criteria. A waiver is a documented decision, not a mute button.

## Benchmark

What exists today is one experiment (June 2026), not a benchmark. The reproducible one — `agent-flow bench`, hidden acceptance tests, several runs per workflow and runtime — is planned; until it lands, read the number below with its limits.

**Setup.** The same project, `linklite` (a URL shortener: base62 slugs, JSON persistence, `POST /shorten`, `GET /:slug`; plain Node, ESM, `node:test`, four requirement ids), built three times in Claude Code from the same requirements:

- *agent-flow, bare*: `plan.json` authored by the host, `next --wave` → executors → `gate` → tier-1 `review` → `advance`.
- *agent-flow, hardened*: same, after `plan validate` (packs flagged 9 gaps at zero tokens) and one hardening agent (`plan harden` → 13 `H<n>` criteria applied, 12.4k tokens, 19.5s).
- *GSD*: new-project → 4 researchers → synthesizer → requirements → roadmap → per phase: planner → plan-checker → TDD executor → verifier (2 phases).

**How quality was measured.** A 10-item hardening checklist checked against the final code: http/https allowlist, body cap with explicit 413, `Cache-Control: no-store` on the 301, write-to-temp-then-rename, serialized concurrent writes, crypto-grade randomness without modulo bias, CR/LF guard on `Location`, malformed slug → 404 without touching the store, corrupt JSON fails loud, bounded collision retry. Plus the test suite and a live boot: `POST` → slug → `GET` → 301, and `javascript:` → 400.

| | agent-flow, bare | agent-flow, hardened | GSD |
| --- | --- | --- | --- |
| Hardening checklist | 2/10 | **10/10** | 7.5/10 |
| Tests | 16/16 | 28/28 | 24/24 |
| Subagents | 5 | 6 | 11 |
| Subagent tokens (as reported by Claude Code) | ~90k | **~116k** | ~475k |
| Agent wall time | ~6 min | **~8.3 min** | ~55 min |
| Acceptance criteria | 10 | 23 (10 + 13 H) | ~16 equivalent |

The hardened loop covered the four gaps the bare loop had shipped (atomic writes, write queue, body cap, redirect cache header) and added four that GSD's pipeline missed (CRLF injection guard, slug-format guard, corrupt-file fail-loud, unbiased randomness — the last one was a finding of GSD's own reviewer that its pipeline did not fix). That is the origin of "24% of the tokens and ~15% of the wall time": 116k vs 475k, 8.3 vs 55 minutes.

**Limits.** One task in one domain. One run per workflow, so no variance. The plan was authored by the tool's author. No hidden acceptance tests: quality was scored by hand against the checklist. Token counts are the per-subagent totals Claude Code reported, not API-billed usage (`agent-flow usage` did not exist yet), and the models per run were not recorded. GSD's pipeline also produces things the loop does not (broad domain research, full process documentation, goal-backward verification), which the checklist does not value. Treat the result as a reason to run the benchmark, not as its conclusion.

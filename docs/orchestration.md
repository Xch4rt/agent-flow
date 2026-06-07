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
```

`advance` is a hard gate: it refuses unless the gates are green for the current code — a worktree content signature ties the cached result to the exact code. Re-running `gate` after any edit is mandatory by construction.

Orchestration overhead stays near zero: each step gets a scoped context pack instead of the whole repo.

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

Building the same project three ways — bare loop, hardened loop, and a research-heavy multi-agent pipeline — the hardened loop matched the heavy pipeline's quality checklist (atomic writes, body caps, redirect cache headers, scheme allowlists, crypto randomness, and more) at **24% of its tokens and ~15% of its wall time**.

---
name: flow-orchestrate
description: Drive the agent-flow orchestration loop as a thin, token-aware dispatcher: one fresh executor per task, gates, independent review, advance — until the plan is done, a phase closes, or a step blocks.
---

# /flow-orchestrate

Use when `.agent-flow/plan.json` exists and the user wants to make progress on the plan.

Requires an authored plan. If `.agent-flow/plan.json` is missing, recommend `/flow-plan` first. If it has draft placeholder tasks ("draft — rename"), stop and recommend refining the plan.

## You are a thin dispatcher

Every turn of this conversation re-reads everything already in it, so keep it small. Executors and reviewers do the heavy reading in their own fresh contexts, on the models `.agent-flow/config.json` assigns.

- Do not read source files, diffs, or full test output here. Executors read code; gates print only a tail.
- Pass file paths and task ids between agents, not contents. Agents write to files and return a short status.
- Never revive a finished or waiting agent with SendMessage. Spawn a fresh one with the envelope plus the new input (gate tail, review findings, handoff file). A revived agent re-reads its whole history, and after ~5 idle minutes its prompt cache has expired, so the whole history is re-written at full price.
- Stop at phase boundaries (step 7). State lives in `plan.json`; resuming costs one envelope, not this conversation's history.

## The loop

1. **Dispatch record:**

   ```sh
   agent-flow next --brief
   ```

   One line: task id, title, and `executor` — the `agent` and `model` a deterministic router picked from the task's signals (scope size, criteria, domain packs, risky wording): `flow-executor-light`, `flow-executor` or `flow-executor-deep`, climbing a rung after repeated red attempts. Do not fetch the full envelope here — the executor does. (`agent-flow next --json` prints the full envelope when you genuinely need it.)

2. **Spawn ONE executor** (subagent_type = `executor.agent`, model = `executor.model`) with a prompt like:

   ```text
   Task <id>. Get your envelope with: agent-flow next --task <id> --json
   <only when retrying:> Previous attempt: <gate tail | review findings | path to .agent-flow/handoffs/<id>.md>
   ```

   Nothing else — no repo summaries, no pasted code.

   Parallel work: `agent-flow next --wave --brief` lists the scope-disjoint batch; spawn one executor per entry (each with its own `executor.agent` and `executor.model`) in a single message. Never let two agents share a scope file.

3. **Read its status block** (≤5 lines). `handoff` → spawn a fresh executor pointing at the handoff file. `blocked` → stop and report.

4. **Run the gates:**

   ```sh
   agent-flow gate --task <id>
   ```

   This run is the authoritative one for escalation. Red → spawn a fresh executor with the failing tail, using the `Next executor` the gate output names (after `escalateAfterFailures` consecutive red attempts it climbs one rung: light → standard → deep → escalation model). Do not weaken tests or acceptance criteria to make a gate pass.

5. **Advance, then commit** (in this order — the gate result is keyed to the working tree, and committing first makes it stale):

   ```sh
   agent-flow advance --task <id>
   git add <files from the executor status> .agent-flow/plan.json .memory && git commit -m "<type>(<scope>): <task title>"
   ```

   Stage only the task's files and agent-flow's state — not scratch files like review prompts, handoffs or `.agent-flow/memory.db`.

6. **Tier-1 review (when advance refuses to close a phase):** the phase needs an independent verdict. Keep the prompt and the verdict out of this conversation:

   ```sh
   agent-flow review emit --phase <N> --reviewer > .agent-flow/review-<N>.prompt.md
   ```

   Spawn a SEPARATE `flow-reviewer` subagent: "Follow .agent-flow/review-<N>.prompt.md; write your JSON verdict to .agent-flow/review-<N>.verdict.json". The reviewer must be independent: do not summarize the code for it, do not hint at a verdict. Then:

   ```sh
   agent-flow review record --phase <N> --from-json .agent-flow/review-<N>.verdict.json
   ```

   If the verdict is `fail`, spawn a fresh executor with the findings file, re-run gates, and re-review with a fresh reviewer. Never record a verdict the reviewer did not produce.

7. **Phase boundary:** when `advance` reports a phase complete, stop the loop. Report, and recommend `/clear` then `/flow-orchestrate` for the next phase.

## Rules

- The gates are the gates: `advance` refusing means the work is not done, not that the tool is wrong.
- Stay inside each task's scope. If the task needs a file outside its scope, stop and recommend editing the plan instead.
- Surface blockers honestly: a failing gate, a fail verdict, or a scope conflict ends the loop with a clear report.

Final response per session: tasks completed, gates run, review verdicts, escalations, current `agent-flow plan show` position. To see what the session cost: `agent-flow usage --since 1d`.

Always end with:

- Recommended next commands: exact copy-pasteable commands or Claude Code skill invocations, ordered by what the user should do next. Include only commands that are useful for the current state.

For orchestration, usually recommend:

1. `/clear` then `/flow-orchestrate` to continue with the next phase
2. `agent-flow plan show` to see position
3. `/flow-verify` then `/flow-close` when stopping for the day

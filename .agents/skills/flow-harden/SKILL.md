---
name: flow-harden
description: Run the domain-hardening pass on .agent-flow/plan.json: pitfall-pack gaps, one hardening subagent, merge its acceptance criteria. Use after authoring or changing the plan and before executing it.
---

# flow-harden

Use after authoring or changing `.agent-flow/plan.json`, before executing it. Cheap insurance: one agent pass turns domain pitfalls into enforceable acceptance criteria.

Workflow:

1. **See the deterministic gaps first:**

   ```sh
   agent-flow plan validate
   ```

   Pack warnings ("matches pack X but has no acceptance covering: ...") are the zero-cost baseline.

2. **Emit the hardening prompt to a file and delegate it to ONE `flow_hardener` subagent** (keeps the prompt out of this thread):

   ```sh
   agent-flow plan harden > .agent-flow/harden.prompt.md
   ```

   Spawn the subagent with `spawn_agent`: `agent_type` = `flow_hardener`, `fork_turns` = `none` (it must not inherit this thread), message: "Follow .agent-flow/harden.prompt.md; write your JSON to .agent-flow/harden.additions.json". The agent proposes missing acceptance criteria as strict JSON. Do not propose criteria yourself — independence is the point. Wait for it to finish.

3. **Apply its output file (prose around the JSON is fine):**

   ```sh
   agent-flow plan harden --apply --from-json .agent-flow/harden.additions.json
   ```

4. **Re-validate and resolve the remainder:**

   ```sh
   agent-flow plan validate
   ```

   For each remaining warning either add a criterion, or waive it CONSCIOUSLY on the task when the concern belongs to another module or is genuinely out of scope:

   ```json
   "waives": ["randomness/crypto-random", "persistence"]
   ```

   A waiver is a documented decision, not a mute button — say why in your summary.

5. Commit the hardened plan.

Final response: criteria added (per task), warnings waived and why, validate status.

Always end with:

- Recommended next commands: exact copy-pasteable commands or Codex skill invocations, ordered by what the user should do next. Include only commands that are useful for the current state.

For hardening, usually recommend:

1. `agent-flow plan validate` to confirm a clean plan
2. `$flow-orchestrate` to start executing

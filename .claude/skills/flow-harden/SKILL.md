---
name: flow-harden
description: Run the domain-hardening pass: pitfall-pack gaps, one hardening reviewer agent, and merge its acceptance criteria into the plan.
---

# /flow-harden

Use after authoring or changing `.agent-flow/plan.json`, before executing it. Cheap insurance: one agent pass turns domain pitfalls into enforceable acceptance criteria.

Workflow:

1. **See the deterministic gaps first:**

   ```sh
   agent-flow plan validate
   ```

   Pack warnings ("matches pack X but has no acceptance covering: ...") are the zero-cost baseline.

2. **Emit the hardening prompt to a file and spawn ONE `flow-hardener` subagent on it** (keeps the prompt out of this conversation):

   ```sh
   agent-flow plan harden > .agent-flow/harden.prompt.md
   ```

   Prompt the subagent: "Follow .agent-flow/harden.prompt.md; write your JSON to .agent-flow/harden.additions.json". The agent proposes missing acceptance criteria as strict JSON. Do not propose criteria yourself — independence is the point.

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

- Recommended next commands: exact copy-pasteable commands or Claude Code skill invocations, ordered by what the user should do next. Include only commands that are useful for the current state.

For hardening, usually recommend:

1. `agent-flow plan validate` to confirm a clean plan
2. `/flow-orchestrate` to start executing

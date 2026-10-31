---
name: flow-quick
description: Handle a small scoped code change with minimal diff and focused verification. Use when the task is narrow, local, and fits in one pass.
---

# flow-quick

Use when the task is narrow, local, and can be completed in one pass.

Workflow:

1. Restate the exact target behavior in one sentence.
2. Before a non-trivial change, run or recommend `agent-flow context "<task>"` for focused indexed project context.
3. Read `.planning/STATE.md`, `AGENTS.md`, and only the code paths needed.
4. Check `git status --short` and avoid unrelated dirty files.
5. Make the smallest coherent diff. Prefer existing patterns over new abstractions.
6. Add or update tests only when the behavior is risky or already covered nearby.
7. Run the narrowest useful verification command through `agent-flow run -- <command>`: it prints only the failures (file:line — reason) and keeps the full log in `.agent-flow/logs/`.
8. Update memory only if the change reveals reusable project knowledge.

Guardrails:

- Do not broaden the feature.
- Do not refactor unrelated code.
- Do not rename or move files unless required.
- Stop and ask if the requested change conflicts with documented requirements.

Final response:

- What changed.
- Verification run.
- Any skipped checks or residual risk.
- Recommended next commands: exact commands or skill invocations to continue.

Verification options:

- Test: `pnpm test`
- Typecheck: `pnpm typecheck`
- Build: `pnpm build`

Always end with:

- Recommended next commands: exact copy-pasteable commands or Codex skill invocations, ordered by what the user should do next. Include only commands that are useful for the current state.

For quick work, usually recommend:

1. The narrowest verification command that applies
2. `$flow-verify`
3. `$flow-close` if the work is complete and worth recording

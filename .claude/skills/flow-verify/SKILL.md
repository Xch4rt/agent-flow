---
name: flow-verify
description: Inspect the diff, run available checks, and detect scope creep before handing work back.
---

# /flow-verify

Use after edits and before final response.

Inspect:

1. `git status --short`
2. `git diff --stat`
3. `git diff` for changed files
4. New or modified tests
5. Planning or memory changes, if any

Detect scope creep:

- Files changed outside the requested area.
- Unrelated formatting churn.
- New abstractions that are not needed for the task.
- Behavior changes without tests or explanation.
- Planning or memory updates that overstate what happened.

Preferred checks:

- Test: `pnpm test`
- Typecheck: `pnpm typecheck`
- Build: `pnpm build`

Run the narrowest checks first, then broader checks when the change touches shared behavior.

Report:

- Diff summary.
- Checks run and results.
- Scope creep findings, or "none found".
- Remaining risks and skipped checks.
- Whether the work is ready to hand back.
- Recommended next commands: exact commands or skill invocations to continue.

Always end with:

- Recommended next commands: exact copy-pasteable commands or Claude Code skill invocations, ordered by what the user should do next. Include only commands that are useful for the current state.

For verification, usually recommend:

1. `/flow-close` when the work is ready and should be recorded
2. The specific command or fix needed when verification fails
3. `git status --short` before commit or handoff

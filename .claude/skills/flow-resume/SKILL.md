---
name: flow-resume
description: Resume a Claude Code session with current state, recent memory, decisions, risks, and next actions.
---

# /flow-resume

Use at the start of a normal session after `agent-flow onboard` has been run. Do not change files unless the user asks.

`/flow-onboard` is optional enrichment when deterministic onboarding is not enough.

First detect shallow or fresh state:

- If `.planning/STATE.md` is missing, empty, or still only says the project was initialized with agent-flow, treat the repo as not onboarded.
- If `.memory/events.jsonl` is missing or empty, treat the repo as not onboarded.

When not onboarded, say exactly:

```text
This project has not been onboarded yet. Run `agent-flow onboard` first.
```

Then mention `/flow-onboard` can add agent-assisted context after deterministic onboarding, and offer a lightweight resume from existing files only. Do not pretend durable project memory exists.

For a specific task, prefer the project-aware context pack before reading raw memory. It uses the internal indexed memory when available:

```sh
agent-flow context "current task or module"
```

Avoid reading all memory when a context pack has enough relevant state.

Read:

1. `AGENTS.md`
2. `.planning/STATE.md`
3. `.planning/PROJECT.md`
4. `.planning/ROADMAP.md`
5. `.planning/DECISIONS.md`
6. `.planning/OPEN_QUESTIONS.md`
7. The last relevant entries from `.memory/events.jsonl`, `.memory/decisions.jsonl`, `.memory/errors.jsonl`, and `.memory/modules.jsonl`

When the CLI is available and you need memory-only detail, use this helper before reading raw JSONL:

```sh
agent-flow memory context "current task or module"
```

Run lightweight checks:

- `git status --short`
- `git log --oneline -5` when commit history helps

Return:

- Project: one or two sentences.
- Current state: what appears active now.
- Recent events: last important memory notes.
- Decisions: durable constraints that affect today.
- Risks: dirty files, failing checks mentioned in memory, unclear requirements, scope hazards.
- Next actions: 3 to 5 concrete options, ordered by usefulness.
- Verification commands: list available checks.
- Recommended next commands: exact commands or skill invocations to continue.

Known verification commands:

- Test: `pnpm test`
- Typecheck: `pnpm typecheck`
- Build: `pnpm build`

Always end with:

- Recommended next commands: exact copy-pasteable commands or Claude Code skill invocations, ordered by what the user should do next. Include only commands that are useful for the current state.

For resume, usually recommend:

1. `agent-flow context "<current task>"` for a task-specific brief
2. `/flow-quick <small task>` for narrow implementation
3. `/flow-plan <larger task>` for multi-phase work
4. `/flow-verify` after edits

---
name: flow-onboard
description: Inspect a repository for the first time and populate agent-flow planning files with useful project context.
---

# /flow-onboard

Use when agent-flow was just installed or the planning files are thin.

First prefer deterministic onboarding when the CLI is available:

```sh
agent-flow onboard
```

Then inspect and improve anything the CLI could not infer.

Goal: combine `agent-flow onboard` baseline context with Claude Code inspection so future `/flow-resume` calls are useful without the user explaining the repo.

Inspect:

1. Read `AGENTS.md` and existing `.planning/*.md`.
2. Run `git status --short` and find relevant source files.
3. Inspect repository structure and identify entry points, app boundaries, generated files, tests, scripts, and deployment/config files.
4. Detect stack from manifests, lockfiles, config files, framework files, database/schema files, Docker files, and source layout.
5. Identify available development, build, test, lint, and typecheck commands.
6. Identify important modules, what they own, and where future agents should start reading.
7. Identify risks: unclear requirements, missing tests, dangerous scripts, migration/data concerns, stale docs, or dirty worktree files.
8. Check recent `.memory/*.jsonl` entries if they exist.

Update planning files:

- `.planning/PROJECT.md`: concise purpose, detected stack, architecture, key directories, and entry points.
- `.planning/REQUIREMENTS.md`: observable product requirements and non-goals. Mark guesses as assumptions.
- `.planning/ROADMAP.md`: near-term phases or milestones if they can be inferred.
- `.planning/STATE.md`: current status, detected commands, important modules, risks, dirty worktree notes, and next actions.
- `.planning/DECISIONS.md`: only real durable decisions found in docs or code. Do not invent decisions.
- `.planning/OPEN_QUESTIONS.md`: important unknowns blocking confident future work.

Append memory only for durable facts:

- `.memory/events.jsonl` with one initial onboarding event.
- `.memory/modules.jsonl` with concise summaries for important modules.

Output a short onboarding report: project purpose, detected stack (not detected yet), key commands, important modules, risks, files updated, memory entries appended, and next actions.

Always end with:

- Recommended next commands: exact copy-pasteable commands or Claude Code skill invocations, ordered by what the user should do next. Include only commands that are useful for the current state.

For onboarding, usually recommend:

1. `agent-flow doctor`
2. `/flow-resume`
3. `agent-flow context "<first task>"` when the user has a specific task
4. `/flow-quick <small task>` or `/flow-plan <larger task>`

Do not implement feature changes during onboarding.

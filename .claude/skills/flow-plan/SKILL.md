---
name: flow-plan
description: Plan larger work as phases with acceptance criteria, risks, and verification before implementation.
---

# /flow-plan

Use when work crosses modules, changes architecture, affects data models, or has unclear requirements.

Workflow:

1. Run or recommend `agent-flow context "<feature or task>"` before creating phases.
2. Read `.planning/PROJECT.md`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`, `.planning/STATE.md`, and relevant memory.
3. Inspect the code paths that define the current behavior.
4. Separate known requirements from assumptions.
5. Break the work into phases that can be reviewed independently.
6. Define acceptance criteria for each phase.
7. Identify migration, compatibility, data, UX, and test risks.
8. List verification commands and manual checks.
9. End with the recommended next commands so the user knows how to proceed.

Plan format:

- Objective: desired outcome in one paragraph.
- Context: files and systems involved.
- Assumptions: only what is not proven.
- Phases: numbered phases, each with scope and acceptance criteria.
- Risks: concrete failure modes.
- Verification: commands and checks.
- Memory updates: planning or JSONL entries to write after completion.
- Recommended next commands: exact commands or Claude Code skill invocations to run next.

For multi-phase work, author the structured orchestration plan so the deterministic loop can drive it:

1. Ensure requirement ids exist in `.planning/REQUIREMENTS.md` (format `CAT-01`).
2. Seed and refine `.agent-flow/plan.json`:

   ```sh
   agent-flow plan init --scaffold
   ```

   Replace draft phases/tasks with real ones: per task set `title`, `scope` (the only files the task may touch), `wave` (same wave = parallelizable when scope-disjoint), `gates` (e.g. `test`, `smoke`), and specific, testable `acceptance` criteria with `proof`.
3. Validate structure, coverage, and pitfall-pack hardening warnings:

   ```sh
   agent-flow plan validate
   ```

Recommended next commands guidance:

- After authoring `.agent-flow/plan.json`, recommend `/flow-harden` (one-agent hardening pass) then `/flow-orchestrate` (execute the loop).
- If the plan is a single narrow change, recommend `/flow-quick <task>` instead of the orchestration loop.
- Recommend `agent-flow context "<task>"` before implementation when the next step needs focused repo context.
- Recommend `/flow-verify` after implementation and `/flow-close` after verification.
- Keep commands copy-pasteable and ordered. Do not include commands that are not useful for the specific plan.

Always end with:

- Recommended next commands: exact copy-pasteable commands or Claude Code skill invocations, ordered by what the user should do next. Include only commands that are useful for the current state.

Do not implement during planning unless the user explicitly asks to proceed.

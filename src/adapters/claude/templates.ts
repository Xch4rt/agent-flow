import type { ProjectDetection } from '../../core/detect-project.js';

function header(name: string, description: string): string {
  return `---
name: ${name}
description: ${description}
---
`;
}

function commandChecklist(detection: ProjectDetection): string {
  const lines = [
    detection.commands.test && `- Test: \`${detection.commands.test}\``,
    detection.commands.lint && `- Lint: \`${detection.commands.lint}\``,
    detection.commands.typecheck && `- Typecheck: \`${detection.commands.typecheck}\``,
    detection.commands.build && `- Build: \`${detection.commands.build}\``,
  ].filter(Boolean);

  return lines.length ? lines.join('\n') : '- No verification commands detected. Inspect package scripts or project docs before choosing checks.';
}

const nextCommandRule = `Always end with:

- Recommended next commands: exact copy-pasteable commands or Claude Code skill invocations, ordered by what the user should do next. Include only commands that are useful for the current state.`;

export function claudeMdTemplate(): string {
  return `@AGENTS.md

## Claude Code

Use Agent Flow for project continuity and orchestrated execution.

Daily loop for planned work (\`.agent-flow/plan.json\`):

- \`/flow-plan <feature>\` — break work into phases/tasks with acceptance criteria
- \`/flow-harden\` — one-agent hardening pass merges domain pitfalls into the plan
- \`/flow-orchestrate\` — execute the loop: next → implement → gate → review → advance

Quick work and continuity:

- \`/flow-quick <small task>\` — narrow change, minimal diff
- \`agent-flow context "<task>"\` — focused context pack (prefer it over reading all \`.planning/\` and \`.memory/\` manually)
- \`/flow-close\` — record durable memory at the end of meaningful work

The gates are the gates: \`agent-flow advance\` refuses to close work whose gates or reviews are not green for the current code. Do not work around it.
`;
}

export function flowOnboardSkill(detection: ProjectDetection): string {
  return `${header('flow-onboard', 'Inspect a repository for the first time and populate agent-flow planning files with useful project context.')}
# /flow-onboard

Use when agent-flow was just installed or the planning files are thin.

First prefer deterministic onboarding when the CLI is available:

\`\`\`sh
agent-flow onboard
\`\`\`

Then inspect and improve anything the CLI could not infer.

Goal: combine \`agent-flow onboard\` baseline context with Claude Code inspection so future \`/flow-resume\` calls are useful without the user explaining the repo.

Inspect:

1. Read \`AGENTS.md\` and existing \`.planning/*.md\`.
2. Run \`git status --short\` and find relevant source files.
3. Inspect repository structure and identify entry points, app boundaries, generated files, tests, scripts, and deployment/config files.
4. Detect stack from manifests, lockfiles, config files, framework files, database/schema files, Docker files, and source layout.
5. Identify available development, build, test, lint, and typecheck commands.
6. Identify important modules, what they own, and where future agents should start reading.
7. Identify risks: unclear requirements, missing tests, dangerous scripts, migration/data concerns, stale docs, or dirty worktree files.
8. Check recent \`.memory/*.jsonl\` entries if they exist.

Update planning files:

- \`.planning/PROJECT.md\`: concise purpose, detected stack, architecture, key directories, and entry points.
- \`.planning/REQUIREMENTS.md\`: observable product requirements and non-goals. Mark guesses as assumptions.
- \`.planning/ROADMAP.md\`: near-term phases or milestones if they can be inferred.
- \`.planning/STATE.md\`: current status, detected commands, important modules, risks, dirty worktree notes, and next actions.
- \`.planning/DECISIONS.md\`: only real durable decisions found in docs or code. Do not invent decisions.
- \`.planning/OPEN_QUESTIONS.md\`: important unknowns blocking confident future work.

Append memory only for durable facts:

- \`.memory/events.jsonl\` with one initial onboarding event.
- \`.memory/modules.jsonl\` with concise summaries for important modules.

Output a short onboarding report: project purpose, detected stack (${detection.stacks.length ? detection.stacks.join(', ') : 'not detected yet'}), key commands, important modules, risks, files updated, memory entries appended, and next actions.

${nextCommandRule}

For onboarding, usually recommend:

1. \`agent-flow doctor\`
2. \`/flow-resume\`
3. \`agent-flow context "<first task>"\` when the user has a specific task
4. \`/flow-quick <small task>\` or \`/flow-plan <larger task>\`

Do not implement feature changes during onboarding.
`;
}

export function flowResumeSkill(detection: ProjectDetection): string {
  return `${header('flow-resume', 'Resume a Claude Code session with current state, recent memory, decisions, risks, and next actions.')}
# /flow-resume

Use at the start of a normal session after \`agent-flow onboard\` has been run. Do not change files unless the user asks.

\`/flow-onboard\` is optional enrichment when deterministic onboarding is not enough.

First detect shallow or fresh state:

- If \`.planning/STATE.md\` is missing, empty, or still only says the project was initialized with agent-flow, treat the repo as not onboarded.
- If \`.memory/events.jsonl\` is missing or empty, treat the repo as not onboarded.

When not onboarded, say exactly:

\`\`\`text
This project has not been onboarded yet. Run \`agent-flow onboard\` first.
\`\`\`

Then mention \`/flow-onboard\` can add agent-assisted context after deterministic onboarding, and offer a lightweight resume from existing files only. Do not pretend durable project memory exists.

For a specific task, prefer the project-aware context pack before reading raw memory. It uses the internal indexed memory when available:

\`\`\`sh
agent-flow context "current task or module"
\`\`\`

Avoid reading all memory when a context pack has enough relevant state.

Read:

1. \`AGENTS.md\`
2. \`.planning/STATE.md\`
3. \`.planning/PROJECT.md\`
4. \`.planning/ROADMAP.md\`
5. \`.planning/DECISIONS.md\`
6. \`.planning/OPEN_QUESTIONS.md\`
7. The last relevant entries from \`.memory/events.jsonl\`, \`.memory/decisions.jsonl\`, \`.memory/errors.jsonl\`, and \`.memory/modules.jsonl\`

When the CLI is available and you need memory-only detail, use this helper before reading raw JSONL:

\`\`\`sh
agent-flow memory context "current task or module"
\`\`\`

Run lightweight checks:

- \`git status --short\`
- \`git log --oneline -5\` when commit history helps

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

${commandChecklist(detection)}

${nextCommandRule}

For resume, usually recommend:

1. \`agent-flow context "<current task>"\` for a task-specific brief
2. \`/flow-quick <small task>\` for narrow implementation
3. \`/flow-plan <larger task>\` for multi-phase work
4. \`/flow-verify\` after edits
`;
}

export function flowQuickSkill(detection: ProjectDetection): string {
  return `${header('flow-quick', 'Handle a small scoped code change with minimal diff and focused verification.')}
# /flow-quick

Use when the task is narrow, local, and can be completed in one pass.

Workflow:

1. Restate the exact target behavior in one sentence.
2. Before a non-trivial change, run or recommend \`agent-flow context "<task>"\` for focused indexed project context.
3. Read \`.planning/STATE.md\`, \`AGENTS.md\`, and only the code paths needed.
4. Check \`git status --short\` and avoid unrelated dirty files.
5. Make the smallest coherent diff. Prefer existing patterns over new abstractions.
6. Add or update tests only when the behavior is risky or already covered nearby.
7. Run the narrowest useful verification command.
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

${commandChecklist(detection)}

${nextCommandRule}

For quick work, usually recommend:

1. The narrowest verification command that applies
2. \`/flow-verify\`
3. \`/flow-close\` if the work is complete and worth recording
`;
}

export function flowPlanSkill(): string {
  return `${header('flow-plan', 'Plan larger work as phases with acceptance criteria, risks, and verification before implementation.')}
# /flow-plan

Use when work crosses modules, changes architecture, affects data models, or has unclear requirements.

Workflow:

1. Run or recommend \`agent-flow context "<feature or task>"\` before creating phases.
2. Read \`.planning/PROJECT.md\`, \`.planning/REQUIREMENTS.md\`, \`.planning/ROADMAP.md\`, \`.planning/STATE.md\`, and relevant memory.
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

1. Ensure requirement ids exist in \`.planning/REQUIREMENTS.md\` (format \`CAT-01\`).
2. Seed and refine \`.agent-flow/plan.json\`:

   \`\`\`sh
   agent-flow plan init --scaffold
   \`\`\`

   Replace draft phases/tasks with real ones: per task set \`title\`, \`scope\` (the only files the task may touch), \`wave\` (same wave = parallelizable when scope-disjoint), \`gates\` (e.g. \`test\`, \`smoke\`), and specific, testable \`acceptance\` criteria with \`proof\`.
3. Validate structure, coverage, and pitfall-pack hardening warnings:

   \`\`\`sh
   agent-flow plan validate
   \`\`\`

Recommended next commands guidance:

- After authoring \`.agent-flow/plan.json\`, recommend \`/flow-harden\` (one-agent hardening pass) then \`/flow-orchestrate\` (execute the loop).
- If the plan is a single narrow change, recommend \`/flow-quick <task>\` instead of the orchestration loop.
- Recommend \`agent-flow context "<task>"\` before implementation when the next step needs focused repo context.
- Recommend \`/flow-verify\` after implementation and \`/flow-close\` after verification.
- Keep commands copy-pasteable and ordered. Do not include commands that are not useful for the specific plan.

${nextCommandRule}

Do not implement during planning unless the user explicitly asks to proceed.
`;
}

export function flowVerifySkill(detection: ProjectDetection): string {
  return `${header('flow-verify', 'Inspect the diff, run available checks, and detect scope creep before handing work back.')}
# /flow-verify

Use after edits and before final response.

Inspect:

1. \`git status --short\`
2. \`git diff --stat\`
3. \`git diff\` for changed files
4. New or modified tests
5. Planning or memory changes, if any

Detect scope creep:

- Files changed outside the requested area.
- Unrelated formatting churn.
- New abstractions that are not needed for the task.
- Behavior changes without tests or explanation.
- Planning or memory updates that overstate what happened.

Preferred checks:

${commandChecklist(detection)}

Run the narrowest checks first, then broader checks when the change touches shared behavior.

Report:

- Diff summary.
- Checks run and results.
- Scope creep findings, or "none found".
- Remaining risks and skipped checks.
- Whether the work is ready to hand back.
- Recommended next commands: exact commands or skill invocations to continue.

${nextCommandRule}

For verification, usually recommend:

1. \`/flow-close\` when the work is ready and should be recorded
2. The specific command or fix needed when verification fails
3. \`git status --short\` before commit or handoff
`;
}

export function flowOrchestrateSkill(): string {
  return `${header('flow-orchestrate', 'Drive the agent-flow orchestration loop: next task, execute, gate, independent review, advance — until the plan is done or blocked.')}
# /flow-orchestrate

Use when \`.agent-flow/plan.json\` exists and the user wants to make progress on the plan. This skill is the daily driver: it runs the deterministic loop and you do the work inside it.

Requires an authored plan. If \`.agent-flow/plan.json\` is missing, recommend \`/flow-plan\` first. If it has draft placeholder tasks ("draft — rename"), stop and recommend refining the plan.

## The loop

Repeat until \`agent-flow plan show\` reports nothing actionable, or a step blocks:

1. **Get the next envelope:**

   \`\`\`sh
   agent-flow next --json
   \`\`\`

   Read the task id, scope files, acceptance criteria, and gates. The envelope's context pack is your briefing — prefer it over re-reading the whole repo.

2. **Execute the task.** Implement ONLY within the task's scope files, satisfying EVERY acceptance criterion (including \`H<n>\` hardening criteria). Write the tests the criteria demand. For independent, scope-disjoint parallel work, use \`agent-flow next --wave --json\` and spawn one executor subagent per envelope (each instructed to stay inside its scope and report results); never let two agents share a scope file.

3. **Run the gates:**

   \`\`\`sh
   agent-flow gate --task <id>
   \`\`\`

   If a gate fails, fix the code and re-run. Do not weaken tests or acceptance criteria to make a gate pass.

4. **Commit the task's work** with a conventional message, then advance:

   \`\`\`sh
   agent-flow advance --task <id>
   \`\`\`

5. **Tier-1 review (when advance refuses to close a phase):** the phase needs an independent verdict.

   \`\`\`sh
   agent-flow review emit --phase <N> --reviewer
   \`\`\`

   Spawn a SEPARATE reviewer subagent with that prompt verbatim (plus the project path). The reviewer must be independent: do not summarize the code for it, do not hint at a verdict. Pipe its raw output back:

   \`\`\`sh
   agent-flow review record --phase <N> --from-json <reviewer-output-file or ->
   \`\`\`

   If the verdict is \`fail\`, fix the findings, re-run gates, and re-review. Never record a verdict the reviewer did not produce.

6. Go back to step 1.

## Rules

- The gates are the gates: \`advance\` refusing means the work is not done, not that the tool is wrong.
- Stay inside each task's scope. If the task needs a file outside its scope, stop and recommend editing the plan instead.
- Surface blockers honestly: a failing gate, a fail verdict, or a scope conflict ends the loop with a clear report.

Final response per session: tasks completed, gates run, review verdicts, current \`agent-flow plan show\` position.

${nextCommandRule}

For orchestration, usually recommend:

1. \`agent-flow plan show\` to see position
2. \`/flow-orchestrate\` to continue the loop
3. \`/flow-verify\` then \`/flow-close\` when stopping for the day
`;
}

export function flowHardenSkill(): string {
  return `${header('flow-harden', 'Run the domain-hardening pass: pitfall-pack gaps, one hardening reviewer agent, and merge its acceptance criteria into the plan.')}
# /flow-harden

Use after authoring or changing \`.agent-flow/plan.json\`, before executing it. Cheap insurance: one agent pass turns domain pitfalls into enforceable acceptance criteria.

Workflow:

1. **See the deterministic gaps first:**

   \`\`\`sh
   agent-flow plan validate
   \`\`\`

   Pack warnings ("matches pack X but has no acceptance covering: ...") are the zero-cost baseline.

2. **Emit the hardening prompt and spawn ONE reviewer subagent with it verbatim:**

   \`\`\`sh
   agent-flow plan harden
   \`\`\`

   The agent proposes missing acceptance criteria as strict JSON. Do not propose criteria yourself — independence is the point.

3. **Apply its raw output (prose around the JSON is fine):**

   \`\`\`sh
   agent-flow plan harden --apply --from-json <file or ->
   \`\`\`

4. **Re-validate and resolve the remainder:**

   \`\`\`sh
   agent-flow plan validate
   \`\`\`

   For each remaining warning either add a criterion, or waive it CONSCIOUSLY on the task when the concern belongs to another module or is genuinely out of scope:

   \`\`\`json
   "waives": ["randomness/crypto-random", "persistence"]
   \`\`\`

   A waiver is a documented decision, not a mute button — say why in your summary.

5. Commit the hardened plan.

Final response: criteria added (per task), warnings waived and why, validate status.

${nextCommandRule}

For hardening, usually recommend:

1. \`agent-flow plan validate\` to confirm a clean plan
2. \`/flow-orchestrate\` to start executing
`;
}

export function flowCloseSkill(): string {
  return `${header('flow-close', 'Close a session by updating state and appending useful memory entries for future resumes.')}
# /flow-close

Use at the end of meaningful work. The goal is continuity, not a diary.

Useful durable memory improves future indexed \`agent-flow context "<task>"\` packs. Keep it concise and non-duplicated.

Update:

- \`.planning/STATE.md\`: current status, changed areas, verification result, next actions.
- \`.planning/DECISIONS.md\`: durable decisions only.
- \`.planning/OPEN_QUESTIONS.md\`: unresolved questions that affect future work.

Append JSONL entries when useful:

- \`.memory/events.jsonl\`: completed work, important context, verification outcome.
- \`.memory/decisions.jsonl\`: decisions with rationale and consequence.
- \`.memory/errors.jsonl\`: errors, root cause, fix, and prevention.
- \`.memory/modules.jsonl\`: module purpose, important files, constraints.

Prefer the CLI append helper when available:

\`\`\`sh
agent-flow memory append --file events --type change --summary "Added deterministic memory validation for CLI append" --module memory --files src/core/jsonl-memory.ts --tags validation,cli
agent-flow memory append --file modules --type module --summary "Memory commands own append, search, and context output" --module memory --files src/commands/memory.ts --tags cli
agent-flow memory append --file decisions --type decision --summary "Keep memory local and schema-validated without semantic search" --status accepted --rationale "v0.3.0 scope is memory quality only"
agent-flow memory append --file errors --type error --summary "Memory append rejected invalid module entries" --module memory --cause "modules require module" --solution "include --module for modules entries"
\`\`\`

Supported \`--file\` values are \`events\`, \`decisions\`, \`errors\`, and \`modules\`. Edit JSONL manually only if the CLI command is unavailable.

JSONL entry shape:

\`\`\`json
{"createdAt":"2026-01-01T00:00:00.000Z","type":"event","summary":"Short durable note","files":["src/example.ts"],"tags":["area"]}
\`\`\`

Rules:

- Keep entries short and factual.
- Avoid vague entries like "updated files" or "fixed bug"; name the durable fact future sessions need.
- Do not duplicate every final response or append exact duplicates.
- Record decisions only when a real durable choice was made.
- Record errors only when both cause and solution are known.
- Do not record secrets.
- Mark uncertainty explicitly.
- Prefer one useful memory entry over many noisy entries.

Final output:

- Files updated.
- Memory entries appended.
- Recommended next commands: exact commands or skill invocations to continue.

${nextCommandRule}

For closeout, usually recommend:

1. \`git status --short\`
2. The relevant commit command if the work is ready
3. \`/flow-resume\` for the next session
`;
}

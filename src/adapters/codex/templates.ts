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

export function flowOnboardSkill(detection: ProjectDetection): string {
  return `${header('flow-onboard', 'Inspect a repository for the first time and populate agent-flow planning files with useful project context.')}
# flow-onboard

Use when agent-flow was just installed or the planning files are thin.

First prefer deterministic onboarding when the CLI is available:

\`\`\`sh
agent-flow onboard
\`\`\`

Then inspect and improve anything the CLI could not infer.

Goal: combine \`agent-flow onboard\` baseline context with Codex inspection so future \`$flow-resume\` calls are useful without the user explaining the repo.

Inspect:

1. Read \`AGENTS.md\` and existing \`.planning/*.md\`.
2. Run \`git status --short\` and \`rg --files\`.
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

Do not implement feature changes during onboarding.
`;
}

export function flowResumeSkill(detection: ProjectDetection): string {
  return `${header('flow-resume', 'Resume a Codex session with current state, recent memory, decisions, risks, and next actions.')}
# flow-resume

Use at the start of a normal session after \`agent-flow onboard\` has been run. Do not change files unless the user asks.

\`$flow-onboard\` is optional enrichment when deterministic onboarding is not enough.

First detect shallow or fresh state:

- If \`.planning/STATE.md\` is missing, empty, or still only says the project was initialized with agent-flow, treat the repo as not onboarded.
- If \`.memory/events.jsonl\` is missing or empty, treat the repo as not onboarded.

When not onboarded, say exactly:

\`\`\`text
This project has not been onboarded yet. Run \`agent-flow onboard\` first.
\`\`\`

Then mention \`$flow-onboard\` can add agent-assisted context after deterministic onboarding, and offer a lightweight resume from existing files only. Do not pretend durable project memory exists.

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
- \`rg --files\` only if planning files are stale or sparse

Return:

- Project: one or two sentences.
- Current state: what appears active now.
- Recent events: last important memory notes.
- Decisions: durable constraints that affect today.
- Risks: dirty files, failing checks mentioned in memory, unclear requirements, scope hazards.
- Next actions: 3 to 5 concrete options, ordered by usefulness.
- Verification commands: list available checks.

Known verification commands:

${commandChecklist(detection)}
`;
}

export function flowQuickSkill(detection: ProjectDetection): string {
  return `${header('flow-quick', 'Handle a small scoped code change with minimal diff and focused verification.')}
# flow-quick

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

Verification options:

${commandChecklist(detection)}
`;
}

export function flowPlanSkill(): string {
  return `${header('flow-plan', 'Plan larger work as phases with acceptance criteria, risks, and verification before implementation.')}
# flow-plan

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

Plan format:

- Objective: desired outcome in one paragraph.
- Context: files and systems involved.
- Assumptions: only what is not proven.
- Phases: numbered phases, each with scope and acceptance criteria.
- Risks: concrete failure modes.
- Verification: commands and checks.
- Memory updates: planning or JSONL entries to write after completion.

Do not implement during planning unless the user explicitly asks to proceed.
`;
}

export function flowVerifySkill(detection: ProjectDetection): string {
  return `${header('flow-verify', 'Inspect the diff, run available checks, and detect scope creep before handing work back.')}
# flow-verify

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
`;
}

export function flowCloseSkill(): string {
  return `${header('flow-close', 'Close a session by updating state and appending useful memory entries for future resumes.')}
# flow-close

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

Final output: files updated, memory entries appended, and the next best action.
`;
}

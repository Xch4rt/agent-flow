import type { ProjectDetection } from '../../core/detect-project.js';
import { CODEX_ROLE_NAMES, CODEX_TIER_AGENTS, DEFAULT_CODEX_MODEL_ROUTING, type ModelRouting } from '../../core/models.js';
import type { Tier } from '../../core/router.js';

/**
 * Codex templates: repo skills (`.agents/skills/<name>/SKILL.md`, invoked as
 * `$flow-*`), their optional `agents/openai.yaml` metadata, and custom agent
 * roles (`.codex/agents/<role>.toml`) with explicit model and reasoning effort.
 */

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

- Recommended next commands: exact copy-pasteable commands or Codex skill invocations, ordered by what the user should do next. Include only commands that are useful for the current state.`;

/** `agents/openai.yaml`: how the ChatGPT desktop app and Codex present the skill. */
export function openaiYaml(displayName: string, shortDescription: string, defaultPrompt: string): string {
  return `interface:
  display_name: ${JSON.stringify(displayName)}
  short_description: ${JSON.stringify(shortDescription)}
  default_prompt: ${JSON.stringify(defaultPrompt)}
`;
}

export const CODEX_SKILL_META: Record<string, { displayName: string; shortDescription: string; defaultPrompt: string }> = {
  'flow-onboard': { displayName: 'Flow Onboard', shortDescription: 'First contact with a repo: fill the planning files', defaultPrompt: 'Use $flow-onboard to inspect this repository and populate the agent-flow planning files.' },
  'flow-resume': { displayName: 'Flow Resume', shortDescription: 'Resume a session from state, memory and decisions', defaultPrompt: 'Use $flow-resume to brief me on the current state before we continue.' },
  'flow-quick': { displayName: 'Flow Quick', shortDescription: 'Small scoped change, minimal diff', defaultPrompt: 'Use $flow-quick for this small change: ' },
  'flow-plan': { displayName: 'Flow Plan', shortDescription: 'Break work into phases/tasks with acceptance criteria', defaultPrompt: 'Use $flow-plan to plan this feature: ' },
  'flow-harden': { displayName: 'Flow Harden', shortDescription: 'Turn domain pitfalls into enforceable acceptance criteria', defaultPrompt: 'Use $flow-harden on the current plan before we execute it.' },
  'flow-orchestrate': { displayName: 'Flow Orchestrate', shortDescription: 'Run the loop: next → executor → gate → review → advance', defaultPrompt: 'Use $flow-orchestrate to make progress on the plan.' },
  'flow-verify': { displayName: 'Flow Verify', shortDescription: 'Inspect the diff, run checks, catch scope creep', defaultPrompt: 'Use $flow-verify on the current changes before handoff.' },
  'flow-close': { displayName: 'Flow Close', shortDescription: 'Record durable memory at the end of a session', defaultPrompt: 'Use $flow-close to record what future sessions need to know.' },
};

export function flowOnboardSkill(detection: ProjectDetection): string {
  return `${header('flow-onboard', 'Inspect a repository for the first time and populate agent-flow planning files with useful project context. Use when agent-flow was just installed or the planning files are thin.')}
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

${nextCommandRule}

For onboarding, usually recommend:

1. \`agent-flow doctor\`
2. \`$flow-resume\`
3. \`agent-flow context "<first task>"\` when the user has a specific task
4. \`$flow-quick <small task>\` or \`$flow-plan <larger task>\`

Do not implement feature changes during onboarding.
`;
}

export function flowResumeSkill(detection: ProjectDetection): string {
  return `${header('flow-resume', 'Resume a Codex session with current state, recent memory, decisions, risks, and next actions. Use at the start of a session on an agent-flow project.')}
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

Cheapest useful resume (prefer it over reading planning and memory wholesale):

\`\`\`sh
agent-flow plan show --agent codex      # when .agent-flow/plan.json exists: position + routed tiers
agent-flow context "current task or module"
\`\`\`

The context pack uses the internal indexed memory when available. Avoid reading all memory when a context pack has enough relevant state.

Read only what the pack did not cover:

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
- Recommended next commands: exact commands or skill invocations to continue.

Known verification commands:

${commandChecklist(detection)}

${nextCommandRule}

For resume, usually recommend:

1. \`$flow-orchestrate\` when \`.agent-flow/plan.json\` has pending tasks
2. \`agent-flow context "<current task>"\` for a task-specific brief
3. \`$flow-quick <small task>\` for narrow implementation
4. \`$flow-plan <larger task>\` for multi-phase work
5. \`$flow-verify\` after edits
`;
}

export function flowQuickSkill(detection: ProjectDetection): string {
  return `${header('flow-quick', 'Handle a small scoped code change with minimal diff and focused verification. Use when the task is narrow, local, and fits in one pass.')}
# flow-quick

Use when the task is narrow, local, and can be completed in one pass.

Workflow:

1. Restate the exact target behavior in one sentence.
2. Before a non-trivial change, run or recommend \`agent-flow context "<task>"\` for focused indexed project context.
3. Read \`.planning/STATE.md\`, \`AGENTS.md\`, and only the code paths needed.
4. Check \`git status --short\` and avoid unrelated dirty files.
5. Make the smallest coherent diff. Prefer existing patterns over new abstractions.
6. Add or update tests only when the behavior is risky or already covered nearby.
7. Run the narrowest useful verification command through \`agent-flow run -- <command>\`: it prints only the failures (file:line — reason) and keeps the full log in \`.agent-flow/logs/\`.
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
2. \`$flow-verify\`
3. \`$flow-close\` if the work is complete and worth recording
`;
}

export function flowPlanSkill(): string {
  return `${header('flow-plan', 'Plan larger work as phases with acceptance criteria, risks, and verification, and author .agent-flow/plan.json for the orchestration loop. Use when work crosses modules, changes architecture, affects data models, or has unclear requirements.')}
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
9. End with the recommended next commands so the user knows how to proceed.

Plan format:

- Objective: desired outcome in one paragraph.
- Context: files and systems involved.
- Assumptions: only what is not proven.
- Phases: numbered phases, each with scope and acceptance criteria.
- Risks: concrete failure modes.
- Verification: commands and checks.
- Memory updates: planning or JSONL entries to write after completion.
- Recommended next commands: exact commands or Codex skill invocations to run next.

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

- After authoring \`.agent-flow/plan.json\`, recommend \`$flow-harden\` (one-agent hardening pass) then \`$flow-orchestrate\` (execute the loop).
- If the plan is a single narrow change, recommend \`$flow-quick <task>\` instead of the orchestration loop.
- Recommend \`agent-flow context "<task>"\` before implementation when the next step needs focused repo context.
- Recommend \`$flow-verify\` after implementation and \`$flow-close\` after verification.
- Keep commands copy-pasteable and ordered. Do not include commands that are not useful for the specific plan.

${nextCommandRule}

Do not implement during planning unless the user explicitly asks to proceed.
`;
}

export function flowVerifySkill(detection: ProjectDetection): string {
  return `${header('flow-verify', 'Inspect the diff, run available checks, and detect scope creep before handing work back. Use after edits and before the final response.')}
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

Run the narrowest checks first, then broader checks when the change touches shared behavior. Run noisy commands through \`agent-flow run -- <command>\` so only the failures reach your context.

Report:

- Diff summary.
- Checks run and results.
- Scope creep findings, or "none found".
- Remaining risks and skipped checks.
- Whether the work is ready to hand back.
- Recommended next commands: exact commands or skill invocations to continue.

${nextCommandRule}

For verification, usually recommend:

1. \`$flow-close\` when the work is ready and should be recorded
2. The specific command or fix needed when verification fails
3. \`git status --short\` before commit or handoff
`;
}

export function flowHardenSkill(): string {
  return `${header('flow-harden', 'Run the domain-hardening pass on .agent-flow/plan.json: pitfall-pack gaps, one hardening subagent, merge its acceptance criteria. Use after authoring or changing the plan and before executing it.')}
# flow-harden

Use after authoring or changing \`.agent-flow/plan.json\`, before executing it. Cheap insurance: one agent pass turns domain pitfalls into enforceable acceptance criteria.

Workflow:

1. **See the deterministic gaps first:**

   \`\`\`sh
   agent-flow plan validate
   \`\`\`

   Pack warnings ("matches pack X but has no acceptance covering: ...") are the zero-cost baseline.

2. **Emit the hardening prompt to a file and delegate it to ONE \`${CODEX_ROLE_NAMES.hardener}\` subagent** (keeps the prompt out of this thread):

   \`\`\`sh
   agent-flow plan harden > .agent-flow/harden.prompt.md
   \`\`\`

   Spawn the subagent with \`spawn_agent\`: \`agent_type\` = \`${CODEX_ROLE_NAMES.hardener}\`, \`fork_turns\` = \`none\` (it must not inherit this thread), message: "Follow .agent-flow/harden.prompt.md; write your JSON to .agent-flow/harden.additions.json". The agent proposes missing acceptance criteria as strict JSON. Do not propose criteria yourself — independence is the point. Wait for it to finish.

3. **Apply its output file (prose around the JSON is fine):**

   \`\`\`sh
   agent-flow plan harden --apply --from-json .agent-flow/harden.additions.json
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
2. \`$flow-orchestrate\` to start executing
`;
}

export function flowOrchestrateSkill(): string {
  const light = CODEX_TIER_AGENTS.light;
  const standard = CODEX_TIER_AGENTS.standard;
  const deep = CODEX_TIER_AGENTS.deep;
  return `${header('flow-orchestrate', 'Drive the agent-flow orchestration loop as a thin, token-aware dispatcher: one fresh executor subagent per task, gates, independent review, advance — until the plan is done, a phase closes, or a step blocks. Use when .agent-flow/plan.json has pending tasks.')}
# flow-orchestrate

Use when \`.agent-flow/plan.json\` exists and the user wants to make progress on the plan.

Requires an authored plan. If \`.agent-flow/plan.json\` is missing, recommend \`$flow-plan\` first. If it has draft placeholder tasks ("draft — rename"), stop and recommend refining the plan.

## You are a thin dispatcher

Every turn of this thread re-reads everything already in it, so keep it small. Executors and reviewers do the heavy reading in their own fresh threads, on the models \`.agent-flow/config.json\` assigns (\`orchestration.codex.tiers\`).

- Do not read source files, diffs, or full test output here. Executors read code; gates print only a tail.
- Pass file paths and task ids between agents, not contents. Agents write to files and return a short status.
- Spawn every executor with \`fork_turns\` = \`none\`: it must start from its envelope, not from this thread's history.
- Never revive a finished agent with \`followup_task\` or \`send_message\` for a retry. Spawn a fresh one with the envelope plus the new input (gate tail, review findings, handoff file). A revived agent re-reads its whole history, and after a few idle minutes its prompt cache has expired, so the whole history is re-read uncached.
- Stop at phase boundaries (step 7). State lives in \`plan.json\`; resuming costs one envelope, not this thread's history.

## The loop

1. **Dispatch record:**

   \`\`\`sh
   agent-flow next --brief --agent codex
   \`\`\`

   One line: task id, title, and \`executor\` — the \`agent\` (a custom agent role from \`.codex/agents/\`: \`${light}\`, \`${standard}\` or \`${deep}\`) and \`model\` a deterministic router picked from the task's signals (scope size, criteria, domain packs, risky wording), climbing a rung after repeated red attempts. Do not fetch the full envelope here — the executor does.

2. **Spawn ONE executor** with \`spawn_agent\`: \`agent_type\` = \`executor.agent\`, \`model\` = \`executor.model\`, \`reasoning_effort\` = \`executor.effort\`, \`fork_turns\` = \`none\`, \`task_name\` = \`task_<id with dots replaced by underscores>\`, message:

   \`\`\`text
   Task <id>. Get your envelope with: agent-flow next --task <id> --json --agent codex
   <only when retrying:> Previous attempt: <gate tail | review findings | path to .agent-flow/handoffs/<id>.md>
   \`\`\`

   Nothing else — no repo summaries, no pasted code. Wait for its result.

   Parallel work: \`agent-flow next --wave --brief --agent codex\` lists the scope-disjoint batch; spawn one executor per entry (each with its own \`executor.agent\` and \`executor.model\`) in the same turn, then wait for all of them. Never let two agents share a scope file.

3. **Read its status block** (≤5 lines). \`handoff\` → spawn a fresh executor pointing at the handoff file. \`blocked\` → stop and report.

4. **Run the gates:**

   \`\`\`sh
   agent-flow gate --task <id> --agent codex
   \`\`\`

   This run is the authoritative one for escalation. Red → spawn a fresh executor with the failing tail, using the \`Next executor\` the gate output names (after \`escalateAfterFailures\` consecutive red attempts it climbs one rung: light → standard → deep → escalation model). Do not weaken tests or acceptance criteria to make a gate pass.

5. **Advance, then commit** (in this order — the gate result is keyed to the working tree, and committing first makes it stale):

   \`\`\`sh
   agent-flow advance --task <id>
   git add <files from the executor status> .agent-flow/plan.json .memory && git commit -m "<type>(<scope>): <task title>"
   \`\`\`

   Stage only the task's files and agent-flow's state — not scratch files like review prompts, handoffs or \`.agent-flow/memory.db\`.

6. **Tier-1 review (when advance refuses to close a phase):** the phase needs an independent verdict. Keep the prompt and the verdict out of this thread:

   \`\`\`sh
   agent-flow review emit --phase <N> --reviewer > .agent-flow/review-<N>.prompt.md
   \`\`\`

   Spawn a SEPARATE \`${CODEX_ROLE_NAMES.reviewer}\` subagent (\`fork_turns\` = \`none\`): "Follow .agent-flow/review-<N>.prompt.md; write your JSON verdict to .agent-flow/review-<N>.verdict.json". The reviewer must be independent: do not summarize the code for it, do not hint at a verdict. Then:

   \`\`\`sh
   agent-flow review record --phase <N> --from-json .agent-flow/review-<N>.verdict.json
   \`\`\`

   If the verdict is \`fail\`, spawn a fresh executor with the findings file, re-run gates, and re-review with a fresh reviewer. Never record a verdict the reviewer did not produce.

7. **Phase boundary:** when \`advance\` reports a phase complete, stop the loop. Report, and recommend \`/new\` (a fresh thread) then \`$flow-orchestrate\` for the next phase.

## Rules

- The gates are the gates: \`advance\` refusing means the work is not done, not that the tool is wrong.
- Stay inside each task's scope. If the task needs a file outside its scope, stop and recommend editing the plan instead.
- Surface blockers honestly: a failing gate, a fail verdict, or a scope conflict ends the loop with a clear report.

Final response per session: tasks completed, gates run, review verdicts, escalations, current \`agent-flow plan show --agent codex\` position. To see what the session cost: \`agent-flow usage --agent codex --since 1d\`.

${nextCommandRule}

For orchestration, usually recommend:

1. \`/new\` then \`$flow-orchestrate\` to continue with the next phase
2. \`agent-flow plan show --agent codex\` to see position
3. \`$flow-verify\` then \`$flow-close\` when stopping for the day
`;
}

export function flowCloseSkill(): string {
  return `${header('flow-close', 'Close a session by updating state and appending useful memory entries for future resumes. Use at the end of meaningful work.')}
# flow-close

Use at the end of meaningful work. The goal is continuity, not a diary.

Useful durable memory improves future indexed \`agent-flow context "<task>"\` packs. Keep it concise and non-duplicated.

Update:

- \`.planning/STATE.md\`: rewrite the current status, changed areas, verification result and next actions (keep it short; it is read at every resume — do not let it grow).
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
3. \`$flow-resume\` for the next session
`;
}

// ---------------------------------------------------------------------------
// Custom agent roles (.codex/agents/<role>.toml)
// ---------------------------------------------------------------------------

/** TOML multi-line basic string: escape backslashes and any `"""` the text might contain. */
export function tomlMultiline(text: string): string {
  const escaped = text.replace(/\\/g, '\\\\').replace(/"""/g, '""\\"');
  return `"""\n${escaped}${escaped.endsWith('\n') ? '' : '\n'}"""`;
}

function tomlString(text: string): string {
  return JSON.stringify(text);
}

function roleToml(fields: { name: string; description: string; model: string; effort: string; instructions: string }): string {
  return `# Generated by agent-flow (init --codex). Models and efforts come from .agent-flow/config.json (orchestration.codex).
name = ${tomlString(fields.name)}
description = ${tomlString(fields.description)}
model = ${tomlString(fields.model)}
model_reasoning_effort = ${tomlString(fields.effort)}
developer_instructions = ${tomlMultiline(fields.instructions)}
`;
}

const TIER_BLURB: Record<Tier, string> = {
  light: 'Light tier: small, low-risk tasks. Be direct; skip broad exploration.',
  standard: 'Standard tier: typical tasks.',
  deep: 'Deep tier: risky or wide tasks (auth, persistence, migrations, concurrency, many files) and escalated retries. Reason carefully about edge cases before editing.',
};

export function codexExecutorRole(routing: ModelRouting = DEFAULT_CODEX_MODEL_ROUTING, tier: Tier = 'standard'): string {
  const budget = Math.round(routing.contextBudgetTokens / 1000);
  const spec = routing.tiers[tier];
  const instructions = `${TIER_BLURB[tier]}

You implement ONE agent-flow task. Your first step: run the envelope command you were given (\`agent-flow next --task <id> --json --agent codex\`). The envelope is your whole briefing: task, scope files, acceptance criteria (including \`H<n>\` hardening criteria), gates, and a budgeted context pack.

Work:

1. Read only what the task needs: the scope files and the specific symbols they touch. Use search and ranged reads over whole-file dumps; do not read \`.planning/\` or \`.memory/\` wholesale — the context pack already selected what matters.
2. Implement ONLY within the scope files. Satisfy EVERY acceptance criterion and write the tests the criteria demand.
3. Run \`agent-flow gate --task <id> --no-record\` (it prints only a short tail; \`--no-record\` keeps your own iterations from counting toward model escalation). Fix and re-run until green. Never weaken tests or criteria.
   For any other noisy command (a single test file, typecheck, lint, build), use \`agent-flow run -- <command>\`: it prints only the failures (file:line — reason) and keeps the full log in \`.agent-flow/logs/\`. Open that log only if the summary is not enough.
4. Do not run \`agent-flow advance\`, do not commit, do not edit the plan — the orchestrator does that.
5. Do not spawn subagents of your own.

Context budget (~${budget}k tokens): every step re-reads your whole history. If you are past roughly ${budget}k tokens of context or ~60 tool calls without green gates, stop (the agent-flow guard hook will deny further tool calls past the budget): write \`.agent-flow/handoffs/<id>.md\` (what is done, what fails, next step, relevant files — under 40 lines) and return \`status: handoff\`.

If the task needs a file outside its scope, stop and return \`status: blocked\` with the reason.

Return ONLY this block (no code, no diff):

\`\`\`text
status: done | handoff | blocked
task: <id>
gate: green | red | not-run
files: <changed files, comma-separated>
notes: <at most 2 lines>
\`\`\`
`;
  return roleToml({
    name: CODEX_TIER_AGENTS[tier],
    description: `Implements exactly one agent-flow task from its envelope, inside its scope, until its gates are green (${tier} tier). Spawned by $flow-orchestrate; returns a short status block, not code.`,
    model: spec.model,
    effort: spec.effort,
    instructions,
  });
}

export function codexReviewerRole(routing: ModelRouting = DEFAULT_CODEX_MODEL_ROUTING): string {
  return roleToml({
    name: CODEX_ROLE_NAMES.reviewer,
    description: 'Independent phase reviewer for agent-flow tier-1 reviews. Reads the emitted review prompt and the actual code, writes a JSON verdict file, returns one line.',
    model: routing.reviewer,
    effort: 'high',
    instructions: `You are an independent reviewer. You were given the path of a review prompt emitted by \`agent-flow review emit --reviewer\` and the path to write your verdict to.

1. Read the review prompt file and follow it exactly. Judge the ACTUAL code in the listed scope files — ignore any summary or claim from the implementer.
2. Read only what the rubric needs: scope files, their tests, and \`git diff\` / \`git log\` for the phase. Prefer ranged reads and search over whole-directory dumps.
3. Write ONLY the JSON verdict the prompt specifies to the verdict file.
4. Return one line: \`verdict: pass|fail — <path>\`.

Default to "fail" if any criterion is unmet, untested, or unclear. Do not modify code. Do not spawn subagents.
`,
  });
}

export function codexHardenerRole(routing: ModelRouting = DEFAULT_CODEX_MODEL_ROUTING): string {
  return roleToml({
    name: CODEX_ROLE_NAMES.hardener,
    description: 'One-pass domain-hardening reviewer for agent-flow plans. Reads the emitted hardening prompt, writes proposed acceptance criteria as JSON to a file, returns one line.',
    model: routing.hardener,
    effort: 'medium',
    instructions: `You were given the path of a hardening prompt emitted by \`agent-flow plan harden\` and the path to write your answer to.

1. Read the prompt file and follow it exactly. It already contains the plan; read source code only if a criterion genuinely depends on existing behavior.
2. Write ONLY the JSON object the prompt specifies to the output file.
3. Return one line: \`additions: <n> — <path>\`.

Propose only missing, specific, testable criteria. Do not edit the plan yourself. Do not spawn subagents.
`,
  });
}

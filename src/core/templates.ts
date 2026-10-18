import { DEFAULT_CODEX_MODEL_ROUTING, DEFAULT_MODEL_ROUTING } from './models.js';
import type { ProjectDetection } from './detect-project.js';

function commandLine(label: string, value: string | undefined): string {
  return `- ${label}: ${value ?? 'Not detected yet'}`;
}

export function agentsTemplate(detection: ProjectDetection): string {
  const stacks = detection.stacks.length ? detection.stacks.join(', ') : 'Not detected yet';

  return `# AGENTS.md

This repository is prepared for AI coding agents with agent-flow.

## Project Snapshot

- Package manager: ${detection.packageManager}
- Detected stack: ${stacks}

## Common Commands

${commandLine('Install', detection.commands.install)}
${commandLine('Dev', detection.commands.dev)}
${commandLine('Build', detection.commands.build)}
${commandLine('Test', detection.commands.test)}
${commandLine('Lint', detection.commands.lint)}
${commandLine('Typecheck', detection.commands.typecheck)}

## Agent Workflow

Skills are the same in both runtimes: \`$flow-*\` in Codex (\`.agents/skills/\`), \`/flow-*\` in Claude Code (\`.claude/skills/\`).

1. For a fresh repo, run \`agent-flow init --codex\` or \`--claude\`, then \`agent-flow onboard\`, then \`flow-resume\`.
2. Planned work: \`flow-plan\` authors \`.agent-flow/plan.json\`, \`flow-harden\` adds domain criteria, \`flow-orchestrate\` runs next → implement → gate → review → advance. \`agent-flow advance\` refuses to close work whose gates are not green for the current code.
3. Use \`.planning/STATE.md\` as the current project truth.
4. Use \`.planning/DECISIONS.md\` for durable technical decisions.
5. Use \`.memory/*.jsonl\` as the reviewable append-only memory log.
6. Treat \`.agent-flow/memory.db\` as an internal generated SQLite index. Do not manually edit it.
7. Prefer \`agent-flow context <task>\` for focused task context before non-trivial agent work.
8. Run noisy commands through \`agent-flow run -- <command>\`: only the failures reach your context.
9. Do not overwrite memory without explicit user instruction.
10. Prefer small scoped changes and avoid unrelated refactors.
11. Run detected verification commands before final response when possible.

## Memory Files

- \`.memory/events.jsonl\`: important repo events and session notes.
- \`.memory/decisions.jsonl\`: durable product or technical decisions.
- \`.memory/errors.jsonl\`: errors, causes, and fixes.
- \`.memory/modules.jsonl\`: notes about important files, modules, and ownership.

## Memory Index

- \`.agent-flow/memory.db\`: internal generated SQLite index for faster local queries and context packs.
- JSONL files remain the source of truth; rebuild the index with \`agent-flow memory rebuild\` if needed.
- Do not commit or manually edit \`.agent-flow/memory.db\`.
`;
}

export function projectTemplate(detection: ProjectDetection): string {
  return `# Project

## Purpose

Never explain your repo twice.

This project uses agent-flow to preserve project context for AI coding sessions.

## Detected Stack

${detection.stacks.length ? detection.stacks.map((stack) => `- ${stack}`).join('\n') : '- Not detected yet'}

## Package Manager

${detection.packageManager}
`;
}

export function requirementsTemplate(): string {
  return `# Requirements

> Define what this project must do. Give each requirement an id of the form
> \`<CATEGORY>-<number>\` (uppercase category + number) — \`agent-flow plan init
> --scaffold\` seeds phases from these ids, and \`agent-flow plan validate\`
> checks coverage against them.

## Example (replace with your own)

- **CORE-01**: <the first capability this project must deliver>
- **CORE-02**: <another specific, testable capability>

## Non-Goals

- <explicit exclusion — and why it is out of scope>
`;
}

export function roadmapTemplate(): string {
  return `# Roadmap

## Now

- Keep project state accurate.
- Capture durable decisions and useful implementation notes.
- Use the flow skills for onboarding, resume, planning, hardening, orchestration, verification, and closeout.

## Later

- Add richer memory indexing.
`;
}

export function stateTemplate(detection: ProjectDetection): string {
  return `# State

## Current Status

Initialized with agent-flow.

## Useful Commands

${commandLine('Install', detection.commands.install)}
${commandLine('Dev', detection.commands.dev)}
${commandLine('Build', detection.commands.build)}
${commandLine('Test', detection.commands.test)}
${commandLine('Lint', detection.commands.lint)}
${commandLine('Typecheck', detection.commands.typecheck)}

## Latest Session Notes

- Add new notes here or append structured entries to \`.memory/events.jsonl\`.
`;
}

export function decisionsTemplate(): string {
  return `# Decisions

Record durable decisions here. Mirror structured decision entries in \`.memory/decisions.jsonl\` when useful.
`;
}

export function openQuestionsTemplate(): string {
  return `# Open Questions

- What should the next focused implementation task be?
`;
}

export function configTemplate(detection: ProjectDetection, adapterIds: string[] = []): string {
  const adapters: Record<string, boolean> = { codex: false, claude: false };
  for (const id of adapterIds) {
    adapters[id] = true;
  }

  const gates: Record<string, string> = {};
  for (const key of ['test', 'typecheck', 'lint', 'build'] as const) {
    const command = detection.commands[key];
    if (command) gates[key] = command;
  }

  return `${JSON.stringify(
    {
      schemaVersion: 1,
      packageManager: detection.packageManager,
      detectedStack: detection.stacks,
      planningDir: '.planning',
      memoryDir: '.memory',
      adapters,
      orchestration: {
        // Named gates run by `agent-flow gate`/`advance` (override or add freely).
        gates,
        // Gates used when a task declares none.
        defaultGates: gates.test ? ['test'] : [],
        // A gate with no resolved command fails instead of being skipped.
        strictGates: false,
        // 0 = deterministic gates only; 1 = require an independent phase review.
        review: { tier: 0 },
        // Token-aware routing. A deterministic router scores each task (scope size,
        // criteria, domain packs, risky wording) into a tier; each tier is an executor
        // subagent with its own model and effort. Gates and review still decide quality.
        router: { enabled: true, thresholds: DEFAULT_MODEL_ROUTING.router.thresholds },
        tiers: DEFAULT_MODEL_ROUTING.tiers,
        models: {
          reviewer: DEFAULT_MODEL_ROUTING.reviewer,
          hardener: DEFAULT_MODEL_ROUTING.hardener,
          escalation: DEFAULT_MODEL_ROUTING.escalation,
        },
        // Same roles for Codex (model slugs and efforts differ; efforts go up to "ultra").
        codex: {
          tiers: DEFAULT_CODEX_MODEL_ROUTING.tiers,
          models: {
            reviewer: DEFAULT_CODEX_MODEL_ROUTING.reviewer,
            hardener: DEFAULT_CODEX_MODEL_ROUTING.hardener,
            escalation: DEFAULT_CODEX_MODEL_ROUTING.escalation,
          },
        },
        // Consecutive red attempts before a task climbs one rung: light → standard → deep → escalation.
        escalateAfterFailures: DEFAULT_MODEL_ROUTING.escalateAfterFailures,
        // Advisory per-agent context budget: agents hand off instead of growing past it.
        contextBudgetTokens: DEFAULT_MODEL_ROUTING.contextBudgetTokens,
      },
    },
    null,
    2,
  )}\n`;
}

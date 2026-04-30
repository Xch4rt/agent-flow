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

1. For a fresh repo, run \`agent-flow init --codex\`, then \`agent-flow onboard\`, then \`$flow-resume\`.
2. Use \`.planning/STATE.md\` as the current project truth.
3. Use \`.planning/DECISIONS.md\` for durable technical decisions.
4. Use \`.memory/*.jsonl\` as the reviewable append-only memory log.
5. Treat \`.agent-flow/memory.db\` as an internal generated SQLite index. Do not manually edit it.
6. Prefer \`agent-flow context <task>\` for focused task context before non-trivial agent work.
7. Do not overwrite memory without explicit user instruction.
8. Prefer small scoped changes and avoid unrelated refactors.
9. Run detected verification commands before final response when possible.

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

This project uses agent-flow to preserve project context for Codex-first AI coding sessions.

## Detected Stack

${detection.stacks.length ? detection.stacks.map((stack) => `- ${stack}`).join('\n') : '- Not detected yet'}

## Package Manager

${detection.packageManager}
`;
}

export function requirementsTemplate(): string {
  return `# Requirements

## Product

- Provide a Codex-first continuity workflow for software projects.
- Keep JSONL memory file-based, readable, and versionable.
- Use SQLite only as an internal generated query index.
- Help agents resume context without manual repo explanations.

## Non-Goals

- No MCP server in the MVP.
- No embeddings in the MVP.
- No dashboard in the MVP.
- No user-managed database in the MVP.
- No Claude support in the MVP.
`;
}

export function roadmapTemplate(): string {
  return `# Roadmap

## Now

- Keep project state accurate.
- Capture durable decisions and useful implementation notes.
- Use Codex skills for onboarding, resume, planning, verification, and closeout.

## Later

- Add richer memory indexing.
- Add additional agent integrations after the Codex workflow is useful.
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

export function configTemplate(detection: ProjectDetection): string {
  return `${JSON.stringify(
    {
      schemaVersion: 1,
      agent: 'codex',
      packageManager: detection.packageManager,
      detectedStack: detection.stacks,
      planningDir: '.planning',
      memoryDir: '.memory',
      skillsDir: '.codex/skills',
    },
    null,
    2,
  )}\n`;
}

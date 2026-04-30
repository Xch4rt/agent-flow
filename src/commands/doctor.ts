import path from 'node:path';
import fs from 'fs-extra';
import pc from 'picocolors';
import { execa } from 'execa';
import { detectProject } from '../core/detect-project.js';
import { formatInvalidMemoryEntry, getInvalidMemoryEntries, getMemoryFiles, readMemoryEntries } from '../core/jsonl-memory.js';
import { getMemoryIndexState, queryMemoryIndex, validateMemoryIndexSchema } from '../core/memory-index.js';
import { getOnboardingState } from '../core/onboard.js';

export const planningFiles = [
  '.planning/PROJECT.md',
  '.planning/REQUIREMENTS.md',
  '.planning/ROADMAP.md',
  '.planning/STATE.md',
  '.planning/DECISIONS.md',
  '.planning/OPEN_QUESTIONS.md',
];

export const codexSkillFiles = [
  '.codex/skills/flow-onboard/SKILL.md',
  '.codex/skills/flow-resume/SKILL.md',
  '.codex/skills/flow-quick/SKILL.md',
  '.codex/skills/flow-plan/SKILL.md',
  '.codex/skills/flow-verify/SKILL.md',
  '.codex/skills/flow-close/SKILL.md',
];

async function commandExists(command: string): Promise<boolean> {
  try {
    await execa(command, ['--version']);
    return true;
  } catch {
    return false;
  }
}

export async function runDoctor(options: { cwd?: string } = {}): Promise<void> {
  const root = options.cwd ?? process.cwd();
  const detection = await detectProject(root);
  const checks: Array<{ label: string; ok: boolean; detail?: string }> = [];

  for (const file of ['AGENTS.md', '.agent-flow/config.json']) {
    checks.push({
      label: file,
      ok: await fs.pathExists(path.join(root, file)),
    });
  }

  for (const file of planningFiles) {
    checks.push({
      label: file,
      ok: await fs.pathExists(path.join(root, file)),
    });
  }

  for (const file of getMemoryFiles(root)) {
    checks.push({
      label: path.relative(root, file),
      ok: await fs.pathExists(file),
    });
  }

  for (const file of codexSkillFiles) {
    checks.push({
      label: file,
      ok: await fs.pathExists(path.join(root, file)),
    });
  }

  const entries = await readMemoryEntries(root);
  const parseErrors = entries.filter((entry) => {
    return typeof entry.value === 'object' && entry.value !== null && 'parseError' in entry.value;
  });
  const invalidMemoryEntries = getInvalidMemoryEntries(entries);
  const memoryIndexState = await getMemoryIndexState(root);

  checks.push({
    label: 'memory JSONL parseability',
    ok: parseErrors.length === 0,
      detail: parseErrors.length > 0 ? `${parseErrors.length} invalid entr${parseErrors.length === 1 ? 'y' : 'ies'}` : undefined,
  });
  checks.push({
    label: 'memory schema validity',
    ok: invalidMemoryEntries.length === 0,
    detail: invalidMemoryEntries.length > 0 ? `${invalidMemoryEntries.length} invalid entr${invalidMemoryEntries.length === 1 ? 'y' : 'ies'}` : undefined,
  });

  const initialized = await fs.pathExists(path.join(root, '.agent-flow/config.json'));
  const onboarding = await getOnboardingState(root);

  if (initialized) {
    checks.push({
      label: 'onboarding generated sections',
      ok: onboarding.hasGeneratedSections,
      detail: onboarding.hasGeneratedSections ? undefined : 'run agent-flow onboard',
    });
    checks.push({
      label: 'onboarding memory event',
      ok: onboarding.hasOnboardingEvent,
      detail: onboarding.hasOnboardingEvent ? undefined : 'run agent-flow onboard',
    });
  }

  if (memoryIndexState.exists) {
    const schema = validateMemoryIndexSchema(root);
    checks.push({
      label: 'memory index schema',
      ok: schema.ok,
      detail: schema.error,
    });
    try {
      await queryMemoryIndex('agent-flow', { cwd: root, limit: 1 });
      checks.push({
        label: 'memory index query',
        ok: true,
      });
    } catch (error) {
      checks.push({
        label: 'memory index query',
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    if (memoryIndexState.status === 'stale') {
      checks.push({
        label: 'memory index freshness',
        ok: true,
        detail: 'stale; run agent-flow memory rebuild or let memory query/context auto-sync',
      });
    }
  } else if (entries.length > 0) {
    checks.push({
      label: 'memory index',
      ok: true,
      detail: 'missing; will be auto-created by memory query or context',
    });
  }

  if (detection.packageManager !== 'unknown') {
    checks.push({
      label: `${detection.packageManager} available`,
      ok: await commandExists(detection.packageManager),
    });
  }

  console.log(pc.bold('agent-flow doctor'));

  for (const check of checks) {
    console.log(`${check.ok ? pc.green('ok') : pc.red('fail')} ${check.label}${check.detail ? ` - ${check.detail}` : ''}`);
  }

  if (invalidMemoryEntries.length > 0) {
    const shown = invalidMemoryEntries.slice(0, 3);
    console.log(pc.yellow('Memory validation details:'));
    for (const entry of shown) {
      for (const line of formatInvalidMemoryEntry(entry)) {
        console.log(line);
      }
    }
    if (invalidMemoryEntries.length > shown.length) {
      console.log(`...and ${invalidMemoryEntries.length - shown.length} more invalid entr${invalidMemoryEntries.length - shown.length === 1 ? 'y' : 'ies'}.`);
    }
    console.log('Run agent-flow memory validate for the full report.');
  }

  const failed = checks.filter((check) => !check.ok).length;
  if (failed > 0) {
    process.exitCode = 1;
  }
}

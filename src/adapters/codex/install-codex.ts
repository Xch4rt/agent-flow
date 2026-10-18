import path from 'node:path';
import type { ProjectDetection } from '../../core/detect-project.js';
import { writeFileSafe, type WriteResult } from '../../core/write-file-safe.js';
import type { AgentAdapter } from '../types.js';
import { CODEX_ROLE_NAMES, CODEX_TIER_AGENTS, DEFAULT_CODEX_MODEL_ROUTING, getModelRouting, type ModelRouting } from '../../core/models.js';
import { installCodexHooks } from '../../core/codex-settings.js';
import {
  CODEX_SKILL_META,
  codexExecutorRole,
  codexHardenerRole,
  codexReviewerRole,
  flowCloseSkill,
  flowHardenSkill,
  flowOnboardSkill,
  flowOrchestrateSkill,
  flowPlanSkill,
  flowQuickSkill,
  flowResumeSkill,
  flowVerifySkill,
  openaiYaml,
} from './templates.js';

/**
 * Codex layout (CLI ≥ 0.160 / ChatGPT desktop, October 2026):
 *
 * - `.agents/skills/<name>/SKILL.md` — repo skills, discovered in any project
 *   (`$flow-*`). `.codex/skills/` is the deprecated location.
 * - `.agents/skills/<name>/agents/openai.yaml` — display metadata.
 * - `.codex/agents/<role>.toml` — custom agent roles with explicit model and
 *   reasoning effort (loaded for trusted projects).
 * - `.codex/hooks.json` — session guard hooks (trusted projects; each hook is
 *   approved once in `/hooks`).
 */

export const CODEX_SKILL_NAMES = [
  'flow-onboard',
  'flow-resume',
  'flow-quick',
  'flow-plan',
  'flow-harden',
  'flow-orchestrate',
  'flow-verify',
  'flow-close',
] as const;

export const CODEX_ROLE_FILES = [
  CODEX_TIER_AGENTS.light,
  CODEX_TIER_AGENTS.standard,
  CODEX_TIER_AGENTS.deep,
  CODEX_ROLE_NAMES.reviewer,
  CODEX_ROLE_NAMES.hardener,
] as const;

export function codexSkillDir(root: string, name: string): string {
  return path.join(root, '.agents', 'skills', name);
}

export function codexRolePath(root: string, role: string): string {
  return path.join(root, '.codex', 'agents', `${role}.toml`);
}

export function codexFiles(
  root: string,
  detection: ProjectDetection,
  routing: ModelRouting = DEFAULT_CODEX_MODEL_ROUTING,
): Array<{ path: string; content: string }> {
  const skills: Array<[string, string]> = [
    ['flow-onboard', flowOnboardSkill(detection)],
    ['flow-resume', flowResumeSkill(detection)],
    ['flow-quick', flowQuickSkill(detection)],
    ['flow-plan', flowPlanSkill()],
    ['flow-harden', flowHardenSkill()],
    ['flow-orchestrate', flowOrchestrateSkill()],
    ['flow-verify', flowVerifySkill(detection)],
    ['flow-close', flowCloseSkill()],
  ];
  const files: Array<{ path: string; content: string }> = [];
  for (const [name, content] of skills) {
    const meta = CODEX_SKILL_META[name];
    files.push({ path: path.join(codexSkillDir(root, name), 'SKILL.md'), content });
    files.push({ path: path.join(codexSkillDir(root, name), 'agents', 'openai.yaml'), content: openaiYaml(meta.displayName, meta.shortDescription, meta.defaultPrompt) });
  }
  // Custom agent roles with explicit models: orchestration roles run on the routed model, not the session's.
  files.push({ path: codexRolePath(root, CODEX_TIER_AGENTS.light), content: codexExecutorRole(routing, 'light') });
  files.push({ path: codexRolePath(root, CODEX_TIER_AGENTS.standard), content: codexExecutorRole(routing, 'standard') });
  files.push({ path: codexRolePath(root, CODEX_TIER_AGENTS.deep), content: codexExecutorRole(routing, 'deep') });
  files.push({ path: codexRolePath(root, CODEX_ROLE_NAMES.reviewer), content: codexReviewerRole(routing) });
  files.push({ path: codexRolePath(root, CODEX_ROLE_NAMES.hardener), content: codexHardenerRole(routing) });
  return files;
}

/** Kept for callers that only need the skill files (doctor, tests). */
export function codexSkillFiles(root: string, detection: ProjectDetection): Array<{ path: string; content: string }> {
  return codexFiles(root, detection).filter((f) => f.path.endsWith('SKILL.md'));
}

export async function installCodex(
  root: string,
  detection: ProjectDetection,
  options: { force?: boolean } = {},
): Promise<WriteResult[]> {
  const results: WriteResult[] = [];
  const routing = await getModelRouting(root, 'codex');
  for (const file of codexFiles(root, detection, routing)) {
    results.push(await writeFileSafe(file.path, file.content, options));
  }
  // Session guard hooks, merged into (never replacing) .codex/hooks.json.
  results.push(await installCodexHooks(root));
  return results;
}

export function codexExpectedFiles(root: string): string[] {
  return [
    ...CODEX_SKILL_NAMES.map((name) => path.join(codexSkillDir(root, name), 'SKILL.md')),
    ...CODEX_ROLE_FILES.map((role) => codexRolePath(root, role)),
  ];
}

export const codexAdapter: AgentAdapter = {
  id: 'codex',
  label: 'Codex',
  install: installCodex,
  expectedFiles: codexExpectedFiles,
};

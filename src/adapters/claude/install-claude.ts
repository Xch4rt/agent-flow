import path from 'node:path';
import type { ProjectDetection } from '../../core/detect-project.js';
import { writeFileSafe, type WriteResult } from '../../core/write-file-safe.js';
import type { AgentAdapter } from '../types.js';
import { DEFAULT_MODEL_ROUTING, getModelRouting, type ModelRouting } from '../../core/models.js';
import {
  claudeMdTemplate,
  flowExecutorAgent,
  flowHardenerAgent,
  flowReviewerAgent,
  flowCloseSkill,
  flowHardenSkill,
  flowOnboardSkill,
  flowOrchestrateSkill,
  flowPlanSkill,
  flowQuickSkill,
  flowResumeSkill,
  flowVerifySkill,
} from './templates.js';

const skillNames = [
  'flow-onboard',
  'flow-resume',
  'flow-quick',
  'flow-plan',
  'flow-harden',
  'flow-orchestrate',
  'flow-verify',
  'flow-close',
];

const agentNames = ['flow-executor', 'flow-reviewer', 'flow-hardener'];

export function claudeFiles(
  root: string,
  detection: ProjectDetection,
  routing: ModelRouting = DEFAULT_MODEL_ROUTING,
): Array<{ path: string; content: string }> {
  return [
    { path: path.join(root, 'CLAUDE.md'), content: claudeMdTemplate() },
    ...([
      ['flow-onboard', flowOnboardSkill(detection)],
      ['flow-resume', flowResumeSkill(detection)],
      ['flow-quick', flowQuickSkill(detection)],
      ['flow-plan', flowPlanSkill()],
      ['flow-harden', flowHardenSkill()],
      ['flow-orchestrate', flowOrchestrateSkill()],
      ['flow-verify', flowVerifySkill(detection)],
      ['flow-close', flowCloseSkill()],
    ] as Array<[string, string]>).map(([name, content]) => ({
      path: path.join(root, '.claude', 'skills', name, 'SKILL.md'),
      content,
    })),
    // Subagents with explicit models: orchestration roles run on the routed model, not the session's.
    { path: path.join(root, '.claude', 'agents', 'flow-executor.md'), content: flowExecutorAgent(routing) },
    { path: path.join(root, '.claude', 'agents', 'flow-reviewer.md'), content: flowReviewerAgent(routing) },
    { path: path.join(root, '.claude', 'agents', 'flow-hardener.md'), content: flowHardenerAgent(routing) },
  ];
}

export async function installClaude(
  root: string,
  detection: ProjectDetection,
  options: { force?: boolean } = {},
): Promise<WriteResult[]> {
  const results: WriteResult[] = [];

  const routing = await getModelRouting(root);
  for (const file of claudeFiles(root, detection, routing)) {
    results.push(await writeFileSafe(file.path, file.content, options));
  }

  return results;
}

export function claudeExpectedFiles(root: string): string[] {
  return [
    path.join(root, 'CLAUDE.md'),
    ...skillNames.map((name) => path.join(root, '.claude', 'skills', name, 'SKILL.md')),
    ...agentNames.map((name) => path.join(root, '.claude', 'agents', `${name}.md`)),
  ];
}

export const claudeAdapter: AgentAdapter = {
  id: 'claude',
  label: 'Claude',
  install: installClaude,
  expectedFiles: claudeExpectedFiles,
};

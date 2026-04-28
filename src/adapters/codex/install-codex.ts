import path from 'node:path';
import type { ProjectDetection } from '../../core/detect-project.js';
import { writeFileSafe, type WriteResult } from '../../core/write-file-safe.js';
import {
  flowCloseSkill,
  flowOnboardSkill,
  flowPlanSkill,
  flowQuickSkill,
  flowResumeSkill,
  flowVerifySkill,
} from './templates.js';

export function codexSkillFiles(root: string, detection: ProjectDetection): Array<{ path: string; content: string }> {
  return [
    ['flow-onboard', flowOnboardSkill(detection)],
    ['flow-resume', flowResumeSkill(detection)],
    ['flow-quick', flowQuickSkill(detection)],
    ['flow-plan', flowPlanSkill()],
    ['flow-verify', flowVerifySkill(detection)],
    ['flow-close', flowCloseSkill()],
  ].map(([name, content]) => ({
    path: path.join(root, '.codex', 'skills', name, 'SKILL.md'),
    content,
  }));
}

export async function installCodex(
  root: string,
  detection: ProjectDetection,
  options: { force?: boolean } = {},
): Promise<WriteResult[]> {
  const results: WriteResult[] = [];

  for (const file of codexSkillFiles(root, detection)) {
    results.push(await writeFileSafe(file.path, file.content, options));
  }

  return results;
}

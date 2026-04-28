import { describe, expect, it } from 'vitest';
import { flowCloseSkill, flowResumeSkill } from '../src/adapters/codex/templates.js';
import type { ProjectDetection } from '../src/core/detect-project.js';

const detection: ProjectDetection = {
  root: '/tmp/example',
  packageManager: 'pnpm',
  stacks: ['Next.js'],
  scripts: {},
  commands: {},
};

describe('Codex skill templates', () => {
  it('flow-resume warns when the project has not been onboarded', () => {
    const skill = flowResumeSkill(detection);

    expect(skill).toContain('First detect shallow or fresh state');
    expect(skill).toContain('This project has not been onboarded yet. Run `$flow-onboard` first.');
    expect(skill).toContain('offer a lightweight resume from existing files only');
  });

  it('flow-close uses createdAt and prefers the memory append CLI', () => {
    const skill = flowCloseSkill();

    expect(skill).toContain('agent-flow memory append');
    expect(skill).toContain('createdAt');
    expect(skill).not.toContain('"timestamp"');
  });
});

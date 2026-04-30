import { describe, expect, it } from 'vitest';
import { flowCloseSkill, flowOnboardSkill, flowPlanSkill, flowQuickSkill, flowResumeSkill } from '../src/adapters/codex/templates.js';
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

    expect(skill).toContain('after `agent-flow onboard` has been run');
    expect(skill).toContain('`$flow-onboard` is optional enrichment');
    expect(skill).toContain('First detect shallow or fresh state');
    expect(skill).toContain('This project has not been onboarded yet. Run `agent-flow onboard` first.');
    expect(skill).toContain('offer a lightweight resume from existing files only');
    expect(skill).toContain('agent-flow context "current task or module"');
    expect(skill).toContain('Avoid reading all memory when a context pack has enough relevant state.');
    expect(skill).toContain('agent-flow memory context');
    expect(skill).not.toContain('after `$flow-onboard` has been run');
  });

  it('flow-onboard mentions deterministic CLI onboarding', () => {
    const skill = flowOnboardSkill(detection);

    expect(skill).toContain('agent-flow onboard');
    expect(skill).toContain('deterministic onboarding');
  });

  it('flow-close uses createdAt and prefers the memory append CLI', () => {
    const skill = flowCloseSkill();

    expect(skill).toContain('agent-flow context "<task>"');
    expect(skill).toContain('concise and non-duplicated');
    expect(skill).toContain('agent-flow memory append');
    expect(skill).toContain('createdAt');
    expect(skill).toContain('Record decisions only when a real durable choice was made.');
    expect(skill).toContain('Record errors only when both cause and solution are known.');
    expect(skill).toContain('Do not duplicate every final response or append exact duplicates.');
    expect(skill).not.toContain('"timestamp"');
  });

  it('flow-quick and flow-plan mention task context packs', () => {
    expect(flowQuickSkill(detection)).toContain('agent-flow context "<task>"');
    expect(flowPlanSkill()).toContain('agent-flow context "<feature or task>"');
  });
});

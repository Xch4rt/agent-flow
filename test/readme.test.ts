import path from 'node:path';
import fs from 'fs-extra';
import { describe, expect, it } from 'vitest';

describe('README daily workflow', () => {
  it('documents the first-time and daily Codex lifecycle', async () => {
    const readme = await fs.readFile(path.join(process.cwd(), 'README.md'), 'utf8');

    expect(readme).toContain('## Daily Workflow');
    expect(readme).toContain('### First-Time Setup');
    expect(readme).toContain('### Daily Use');
    expect(readme).toContain('### When To Use Each Skill');
    expect(readme).toContain('agent-flow init --codex');
    expect(readme).toContain('$flow-onboard');
    expect(readme).toContain('$flow-resume');
    expect(readme).toContain('$flow-quick');
    expect(readme).toContain('$flow-plan');
    expect(readme).toContain('$flow-verify');
    expect(readme).toContain('$flow-close');
  });

  it('has balanced Markdown code fences', async () => {
    const readme = await fs.readFile(path.join(process.cwd(), 'README.md'), 'utf8');
    const fenceCount = readme.match(/```/g)?.length ?? 0;

    expect(fenceCount % 2).toBe(0);
  });
});

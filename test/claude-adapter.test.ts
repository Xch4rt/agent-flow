import path from 'node:path';
import os from 'node:os';
import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runInit } from '../src/commands/init.js';
import { claudeAdapter } from '../src/adapters/claude/install-claude.js';
import { claudeMdTemplate, flowResumeSkill, flowCloseSkill, flowHardenSkill, flowOrchestrateSkill } from '../src/adapters/claude/templates.js';
import type { ProjectDetection } from '../src/core/detect-project.js';

let tmpDir: string;

const detection: ProjectDetection = {
  root: '/tmp/example',
  packageManager: 'pnpm',
  stacks: ['Next.js'],
  scripts: {},
  commands: {},
};

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-flow-claude-test-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.remove(tmpDir);
});

function output(): string {
  return vi.mocked(console.log).mock.calls.map((call) => String(call[0])).join('\n');
}

describe('Claude adapter', () => {
  it('has correct id and label', () => {
    expect(claudeAdapter.id).toBe('claude');
    expect(claudeAdapter.label).toBe('Claude');
  });

  it('expectedFiles includes CLAUDE.md and skill files', () => {
    const files = claudeAdapter.expectedFiles(tmpDir);
    const relative = files.map((f) => path.relative(tmpDir, f));
    expect(relative).toContain('CLAUDE.md');
    expect(relative).toContain('.claude/skills/flow-resume/SKILL.md');
    expect(relative).toContain('.claude/skills/flow-close/SKILL.md');
    expect(relative).toContain('.claude/skills/flow-harden/SKILL.md');
    expect(relative).toContain('.claude/skills/flow-orchestrate/SKILL.md');
    expect(relative).toHaveLength(9);
  });
});

describe('Claude templates', () => {
  it('CLAUDE.md imports @AGENTS.md and teaches the daily loop', () => {
    const content = claudeMdTemplate();
    expect(content).toContain('@AGENTS.md');
    expect(content).toContain('## Claude Code');
    expect(content).toContain('/flow-orchestrate');
    expect(content).toContain('/flow-harden');
    expect(content).toContain('/flow-close');
    expect(content).toContain('The gates are the gates');
  });

  it('skills use slash-command style', () => {
    const resume = flowResumeSkill(detection);
    expect(resume).toContain('/flow-resume');
    expect(resume).toContain('/flow-onboard');
    expect(resume).not.toContain('$flow-resume');

    const close = flowCloseSkill();
    expect(close).toContain('/flow-close');
    expect(close).toContain('/flow-resume');
    expect(close).not.toContain('$flow-close');
  });

  it('skills have frontmatter with name and description', () => {
    const resume = flowResumeSkill(detection);
    expect(resume).toMatch(/^---\nname: flow-resume\ndescription: /);
  });

  it('orchestrate skill drives the full loop with independent review', () => {
    const orchestrate = flowOrchestrateSkill();
    expect(orchestrate).toMatch(/^---\nname: flow-orchestrate\ndescription: /);
    expect(orchestrate).toContain('agent-flow next --json');
    expect(orchestrate).toContain('agent-flow gate --task');
    expect(orchestrate).toContain('agent-flow advance --task');
    expect(orchestrate).toContain('review emit --phase <N> --reviewer');
    expect(orchestrate).toContain('review record --phase <N> --from-json');
    expect(orchestrate).toContain('next --wave');
    // Independence and honesty guardrails must be explicit.
    expect(orchestrate).toContain('do not hint at a verdict');
    expect(orchestrate).toContain('Never record a verdict the reviewer did not produce');
  });

  it('harden skill runs emit, apply, and conscious waivers', () => {
    const harden = flowHardenSkill();
    expect(harden).toMatch(/^---\nname: flow-harden\ndescription: /);
    expect(harden).toContain('agent-flow plan harden');
    expect(harden).toContain('plan harden --apply --from-json');
    expect(harden).toContain('agent-flow plan validate');
    expect(harden).toContain('waives');
  });
});

describe('init --claude', () => {
  it('creates Claude files and CLAUDE.md', async () => {
    await fs.writeJson(path.join(tmpDir, 'package.json'), {
      scripts: { test: 'vitest run' },
      dependencies: { next: '^15.0.0' },
    });
    await fs.writeFile(path.join(tmpDir, 'pnpm-lock.yaml'), '');

    await runInit({ claude: true, cwd: tmpDir });

    await expect(fs.pathExists(path.join(tmpDir, 'CLAUDE.md'))).resolves.toBe(true);
    await expect(fs.pathExists(path.join(tmpDir, '.claude/skills/flow-resume/SKILL.md'))).resolves.toBe(true);
    await expect(fs.pathExists(path.join(tmpDir, '.claude/skills/flow-close/SKILL.md'))).resolves.toBe(true);

    const claudeMd = await fs.readFile(path.join(tmpDir, 'CLAUDE.md'), 'utf8');
    expect(claudeMd).toContain('@AGENTS.md');

    const config = await fs.readJson(path.join(tmpDir, '.agent-flow/config.json'));
    expect(config.adapters.claude).toBe(true);
    expect(config.adapters.codex).toBe(false);
  });
});

describe('init --agent all', () => {
  it('creates both Codex and Claude files', async () => {
    await fs.writeJson(path.join(tmpDir, 'package.json'), {
      scripts: { test: 'vitest run' },
    });

    await runInit({ agent: 'all', cwd: tmpDir });

    await expect(fs.pathExists(path.join(tmpDir, '.codex/skills/flow-resume/SKILL.md'))).resolves.toBe(true);
    await expect(fs.pathExists(path.join(tmpDir, 'CLAUDE.md'))).resolves.toBe(true);
    await expect(fs.pathExists(path.join(tmpDir, '.claude/skills/flow-resume/SKILL.md'))).resolves.toBe(true);

    const config = await fs.readJson(path.join(tmpDir, '.agent-flow/config.json'));
    expect(config.adapters.codex).toBe(true);
    expect(config.adapters.claude).toBe(true);
  });
});

describe('init --codex still works', () => {
  it('creates Codex files but not Claude files', async () => {
    await runInit({ codex: true, cwd: tmpDir });

    await expect(fs.pathExists(path.join(tmpDir, '.codex/skills/flow-resume/SKILL.md'))).resolves.toBe(true);
    await expect(fs.pathExists(path.join(tmpDir, 'CLAUDE.md'))).resolves.toBe(false);

    const config = await fs.readJson(path.join(tmpDir, '.agent-flow/config.json'));
    expect(config.adapters.codex).toBe(true);
    expect(config.adapters.claude).toBe(false);
  });
});

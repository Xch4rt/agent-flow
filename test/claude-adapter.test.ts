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
    expect(relative).toContain('.claude/agents/flow-executor-light.md');
    expect(relative).toContain('.claude/agents/flow-executor.md');
    expect(relative).toContain('.claude/agents/flow-executor-deep.md');
    expect(relative).toContain('.claude/agents/flow-reviewer.md');
    expect(relative).toContain('.claude/agents/flow-hardener.md');
    expect(relative).toHaveLength(14);
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
    expect(config.orchestration.models).toEqual({ reviewer: 'sonnet', hardener: 'sonnet', escalation: 'opus' });
    expect(config.orchestration.router).toEqual({ enabled: true, thresholds: { standard: 2, deep: 5 } });
    expect(config.orchestration.tiers.light).toEqual({ model: 'haiku', effort: 'low' });
    expect(config.orchestration.escalateAfterFailures).toBe(2);

    const executor = await fs.readFile(path.join(tmpDir, '.claude/agents/flow-executor.md'), 'utf8');
    expect(executor).toMatch(/^---\nname: flow-executor\ndescription: .+\nmodel: sonnet\neffort: medium\nhooks:\n/);
    const light = await fs.readFile(path.join(tmpDir, '.claude/agents/flow-executor-light.md'), 'utf8');
    expect(light).toMatch(/^---\nname: flow-executor-light\ndescription: .+\nmodel: haiku\neffort: low\nhooks:\n/);
    const deep = await fs.readFile(path.join(tmpDir, '.claude/agents/flow-executor-deep.md'), 'utf8');
    expect(deep).toMatch(/\nmodel: sonnet\neffort: high\n/);
    expect(await fs.readFile(path.join(tmpDir, '.claude/agents/flow-reviewer.md'), 'utf8')).toContain('effort: high');
    await expect(fs.pathExists(path.join(tmpDir, '.claude/agents/flow-reviewer.md'))).resolves.toBe(true);
    await expect(fs.pathExists(path.join(tmpDir, '.claude/agents/flow-hardener.md'))).resolves.toBe(true);
  });

  it('writes agent models from an existing config', async () => {
    await fs.ensureDir(path.join(tmpDir, '.agent-flow'));
    await fs.writeJson(path.join(tmpDir, '.agent-flow/config.json'), {
      schemaVersion: 1,
      adapters: { claude: true },
      orchestration: { models: { executor: 'haiku', reviewer: 'opus' }, tiers: { deep: { model: 'opus', effort: 'xhigh' } }, contextBudgetTokens: 80000 },
    });
    await runInit({ claude: true, cwd: tmpDir });
    const executor = await fs.readFile(path.join(tmpDir, '.claude/agents/flow-executor.md'), 'utf8');
    const reviewer = await fs.readFile(path.join(tmpDir, '.claude/agents/flow-reviewer.md'), 'utf8');
    const hardener = await fs.readFile(path.join(tmpDir, '.claude/agents/flow-hardener.md'), 'utf8');
    expect(executor).toContain('model: haiku');
    expect(executor).toContain('~80k tokens');
    expect(reviewer).toContain('model: opus');
    expect(hardener).toContain('model: sonnet');
    const deep = await fs.readFile(path.join(tmpDir, '.claude/agents/flow-executor-deep.md'), 'utf8');
    expect(deep).toContain('model: opus');
    expect(deep).toContain('effort: xhigh');
  });
});

describe('token-aware orchestration skill', () => {
  it('dispatches fresh executors and keeps heavy content out of the main thread', () => {
    const skill = flowOrchestrateSkill();
    expect(skill).toContain('agent-flow next --brief');
    expect(skill).toContain('agent-flow next --task <id> --json');
    expect(skill).toContain('flow-executor-light');
    expect(skill).toContain('flow-executor-deep');
    expect(skill).toContain('subagent_type = \`executor.agent\`');
    expect(skill).toContain('flow-reviewer');
    expect(skill).toContain('Never revive a finished or waiting agent with SendMessage');
    expect(skill).toContain('review emit --phase <N> --reviewer > .agent-flow/review-<N>.prompt.md');
    expect(skill).toContain('/clear');
  });

  it('advances before committing (committing first makes the gate result stale)', () => {
    const skill = flowOrchestrateSkill();
    const advance = skill.indexOf('agent-flow advance --task <id>\n');
    const commit = skill.indexOf('&& git commit');
    expect(advance).toBeGreaterThan(-1);
    expect(commit).toBeGreaterThan(advance);
  });

  it('harden skill routes through the flow-hardener agent with file handoff', () => {
    const harden = flowHardenSkill();
    expect(harden).toContain('flow-hardener');
    expect(harden).toContain('agent-flow plan harden > .agent-flow/harden.prompt.md');
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

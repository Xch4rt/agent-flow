import path from 'node:path';
import os from 'node:os';
import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runInit } from '../src/commands/init.js';
import { runGateCommand, runNext } from '../src/commands/orchestrate.js';
import { runPlanShow } from '../src/commands/plan.js';
import { codexAdapter } from '../src/adapters/codex/install-codex.js';
import { codexHooksInstalled, installCodexHooks, legacyCodexSkillDirs } from '../src/core/codex-settings.js';
import { resolveTargetAgent } from '../src/core/config.js';
import { DEFAULT_CODEX_MODEL_ROUTING, executorAssignment, getModelRouting } from '../src/core/models.js';
import { emptyPlan, writePlan } from '../src/core/plan.js';
import type { Task } from '../src/core/plan-schema.js';

let tmpDir: string;

const SMALL: Task = {
  id: '1.1', title: 'rename label', status: 'pending', wave: 1, dependsOn: [], scope: ['src/ui/label.ts'], gates: ['test'],
  acceptance: [{ id: 'A1', text: 'label renamed', proof: 'test' }], waives: [],
};
const RISKY: Task = {
  id: '1.2', title: 'add password reset with token persistence and migration', status: 'pending', wave: 1, dependsOn: [],
  scope: ['src/auth/reset.ts', 'src/auth/token.ts', 'src/db/migrations/003.ts', 'src/db/store.ts', 'src/http/routes.ts', 'src/mail/send.ts'],
  gates: ['test'],
  acceptance: [
    { id: 'A1', text: 'token is single-use', proof: 'test' },
    { id: 'A2', text: 'token expires', proof: 'test' },
    { id: 'A3', text: 'secrets never logged', proof: 'test' },
    { id: 'H1', text: 'crypto-grade randomness', proof: 'test' },
  ],
  waives: [],
};

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-flow-codex-test-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  delete process.env.AGENT_FLOW_AGENT;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.remove(tmpDir);
  process.exitCode = undefined;
});

function logged(): string[] {
  return vi.mocked(console.log).mock.calls.map((call) => String(call[0]));
}

async function setupPlan(init: { codex?: boolean; claude?: boolean } = { codex: true }): Promise<void> {
  await runInit({ ...init, cwd: tmpDir });
  await writePlan(tmpDir, {
    ...emptyPlan(new Date('2026-01-01T00:00:00.000Z')),
    phases: [{ id: '1', title: 'P1', goal: '', requirements: [], dependsOn: [], status: 'pending', tasks: [SMALL, RISKY] }],
  });
  vi.mocked(console.log).mockClear();
}

describe('Codex adapter', () => {
  it('expects repo skills in .agents/skills and roles in .codex/agents', () => {
    const files = codexAdapter.expectedFiles(tmpDir).map((f) => path.relative(tmpDir, f));
    expect(files).toEqual([
      '.agents/skills/flow-onboard/SKILL.md',
      '.agents/skills/flow-resume/SKILL.md',
      '.agents/skills/flow-quick/SKILL.md',
      '.agents/skills/flow-plan/SKILL.md',
      '.agents/skills/flow-harden/SKILL.md',
      '.agents/skills/flow-orchestrate/SKILL.md',
      '.agents/skills/flow-verify/SKILL.md',
      '.agents/skills/flow-close/SKILL.md',
      '.codex/agents/flow_executor_light.toml',
      '.codex/agents/flow_executor.toml',
      '.codex/agents/flow_executor_deep.toml',
      '.codex/agents/flow_reviewer.toml',
      '.codex/agents/flow_hardener.toml',
    ]);
  });

  it('init --codex writes skills with openai.yaml, roles from config, hooks and the codex config block', async () => {
    await fs.outputJson(path.join(tmpDir, '.agent-flow', 'config.json'), {
      schemaVersion: 1,
      adapters: { codex: true },
      orchestration: { codex: { tiers: { light: { model: 'gpt-5.6-luna', effort: 'low' } }, models: { reviewer: 'gpt-6-astra' } } },
    });
    await runInit({ codex: true, cwd: tmpDir });

    const yaml = await fs.readFile(path.join(tmpDir, '.agents/skills/flow-orchestrate/agents/openai.yaml'), 'utf8');
    expect(yaml).toContain('display_name: "Flow Orchestrate"');

    const light = await fs.readFile(path.join(tmpDir, '.codex/agents/flow_executor_light.toml'), 'utf8');
    expect(light).toContain('model = "gpt-5.6-luna"');
    const reviewer = await fs.readFile(path.join(tmpDir, '.codex/agents/flow_reviewer.toml'), 'utf8');
    expect(reviewer).toContain('model = "gpt-6-astra"');
    const standard = await fs.readFile(path.join(tmpDir, '.codex/agents/flow_executor.toml'), 'utf8');
    expect(standard).toContain(`model = "${DEFAULT_CODEX_MODEL_ROUTING.tiers.standard.model}"`);

    const hooks = await fs.readJson(path.join(tmpDir, '.codex/hooks.json'));
    expect(hooks.hooks.UserPromptSubmit[0].hooks[0].command).toContain('agent-flow guard prompt');
    expect(hooks.hooks.PreToolUse[0].hooks[0].command).toContain('agent-flow guard tool');
    expect(hooks.hooks.PreToolUse[0].matcher).toBeUndefined();

    // A fresh config gets the Codex block with the default slugs.
    await fs.remove(path.join(tmpDir, '.agent-flow', 'config.json'));
    await runInit({ codex: true, cwd: tmpDir, force: true });
    const config = await fs.readJson(path.join(tmpDir, '.agent-flow', 'config.json'));
    expect(config.orchestration.codex.tiers.standard).toEqual({ model: 'gpt-6.1-sol', effort: 'medium' });
    expect(config.orchestration.codex.models.escalation).toBe('gpt-6-astra');
    expect(config.orchestration.tiers.light.model).toBe('haiku');
  });

  it('does not write legacy .codex/skills and doctor flags leftovers', async () => {
    await runInit({ codex: true, cwd: tmpDir });
    expect(await fs.pathExists(path.join(tmpDir, '.codex/skills'))).toBe(false);
    expect(await legacyCodexSkillDirs(tmpDir)).toEqual([]);
    await fs.outputFile(path.join(tmpDir, '.codex/skills/flow-resume/SKILL.md'), '---\nname: flow-resume\ndescription: old\n---\n');
    expect(await legacyCodexSkillDirs(tmpDir)).toEqual(['.codex/skills/flow-resume']);
  });
});

describe('Codex hooks', () => {
  it('merges into an existing hooks.json without touching other hooks, idempotently', async () => {
    const file = path.join(tmpDir, '.codex', 'hooks.json');
    await fs.outputJson(file, { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'my-policy' }] }] }, other: 1 });
    expect(await installCodexHooks(tmpDir)).toMatchObject({ status: 'overwritten' });
    const merged = await fs.readJson(file);
    expect(merged.other).toBe(1);
    expect(merged.hooks.PreToolUse).toHaveLength(2);
    expect(merged.hooks.PreToolUse[0].hooks[0].command).toBe('my-policy');
    expect(merged.hooks.UserPromptSubmit).toHaveLength(1);
    expect(await codexHooksInstalled(tmpDir)).toEqual({ prompt: true, tool: true });
    expect(await installCodexHooks(tmpDir)).toMatchObject({ status: 'skipped' });
    expect((await fs.readJson(file)).hooks.PreToolUse).toHaveLength(2);
  });

  it('never overwrites an unparseable hooks.json', async () => {
    const file = path.join(tmpDir, '.codex', 'hooks.json');
    await fs.outputFile(file, '{ not json');
    expect(await installCodexHooks(tmpDir)).toMatchObject({ status: 'skipped' });
    expect(await fs.readFile(file, 'utf8')).toBe('{ not json');
    expect(await codexHooksInstalled(tmpDir)).toEqual({ prompt: false, tool: false });
  });
});

describe('Codex model routing', () => {
  it('reads orchestration.codex overrides, accepts ultra, and falls back to Codex defaults', async () => {
    await fs.outputJson(path.join(tmpDir, '.agent-flow', 'config.json'), {
      orchestration: {
        router: { thresholds: { standard: 1, deep: 3 } },
        tiers: { light: { model: 'opus', effort: 'max' } },
        codex: { tiers: { deep: { model: 'gpt-6-astra', effort: 'ultra' }, light: { effort: 'nope' } }, models: { escalation: 'gpt-reserve', reviewer: '' } },
      },
    });
    const codex = await getModelRouting(tmpDir, 'codex');
    expect(codex.agent).toBe('codex');
    expect(codex.tiers.deep).toEqual({ model: 'gpt-6-astra', effort: 'ultra' });
    expect(codex.tiers.light).toEqual({ model: 'gpt-6-luna', effort: 'low' });
    expect(codex.escalation).toBe('gpt-reserve');
    expect(codex.reviewer).toBe('gpt-6.1-sol');
    expect(codex.router.thresholds).toEqual({ standard: 1, deep: 3 });

    // Claude's table is untouched by the codex block, and ultra is not a Claude effort.
    const claude = await getModelRouting(tmpDir, 'claude');
    expect(claude.tiers.light).toEqual({ model: 'opus', effort: 'max' });
    expect(claude.tiers.deep.model).toBe('sonnet');
    await fs.outputJson(path.join(tmpDir, '.agent-flow', 'config.json'), { orchestration: { tiers: { deep: { model: 'opus', effort: 'ultra' } } } });
    expect((await getModelRouting(tmpDir, 'claude')).tiers.deep).toEqual({ model: 'opus', effort: 'high' });
  });

  it('assigns Codex role names and climbs to the Codex escalation model', () => {
    expect(executorAssignment(DEFAULT_CODEX_MODEL_ROUTING, undefined, SMALL)).toMatchObject({
      runtime: 'codex', agent: 'flow_executor_light', model: 'gpt-6-luna', effort: 'low', rung: 'light',
    });
    const stats = { runs: 6, failures: 6, consecutiveFailures: 6, lastAt: '' };
    expect(executorAssignment(DEFAULT_CODEX_MODEL_ROUTING, stats, SMALL)).toMatchObject({
      agent: 'flow_executor_deep', model: 'gpt-6-astra', rung: 'escalation', escalated: true,
    });
  });

  it('resolves the target runtime: flag > env > the only installed adapter > claude', async () => {
    await fs.outputJson(path.join(tmpDir, '.agent-flow', 'config.json'), { adapters: { codex: true, claude: false } });
    expect(await resolveTargetAgent(tmpDir)).toBe('codex');
    expect(await resolveTargetAgent(tmpDir, 'claude')).toBe('claude');
    process.env.AGENT_FLOW_AGENT = 'claude';
    expect(await resolveTargetAgent(tmpDir)).toBe('claude');
    delete process.env.AGENT_FLOW_AGENT;
    await fs.outputJson(path.join(tmpDir, '.agent-flow', 'config.json'), { adapters: { codex: true, claude: true } });
    expect(await resolveTargetAgent(tmpDir)).toBe('claude');
    await expect(resolveTargetAgent(tmpDir, 'gemini')).rejects.toThrow('Unknown agent');
  });
});

describe('orchestration for Codex', () => {
  it('next --brief names the Codex role and model, and the envelope command carries --agent codex', async () => {
    await setupPlan();
    await runNext({ cwd: tmpDir, brief: true });
    expect(JSON.parse(logged()[0])).toEqual({
      task: '1.1',
      title: 'rename label',
      phase: '1',
      wave: 1,
      executor: { agent: 'flow_executor_light', model: 'gpt-6-luna', effort: 'low', tier: 'light', escalated: false },
      envelope: 'agent-flow next --task 1.1 --json --agent codex',
    });
  });

  it('--agent overrides the installed default in both directions', async () => {
    await setupPlan({ codex: true, claude: true });
    await runNext({ cwd: tmpDir, brief: true, peek: true });
    expect(JSON.parse(logged()[0]).executor.agent).toBe('flow-executor-light');
    vi.mocked(console.log).mockClear();
    await runNext({ cwd: tmpDir, brief: true, peek: true, agent: 'codex' });
    expect(JSON.parse(logged()[0]).executor).toMatchObject({ agent: 'flow_executor_light', model: 'gpt-6-luna' });
    vi.mocked(console.log).mockClear();
    await runNext({ cwd: tmpDir, task: '1.2', json: true, peek: true, agent: 'codex' });
    expect(JSON.parse(logged()[0]).executor).toMatchObject({ runtime: 'codex', agent: 'flow_executor_deep', model: 'gpt-6.1-sol', effort: 'high' });
  });

  it('wave briefs and plan show use the Codex names', async () => {
    await setupPlan();
    await runNext({ cwd: tmpDir, wave: true, brief: true, peek: true });
    expect(JSON.parse(logged()[0]).batch.map((b: { executor: { agent: string } }) => b.executor.agent)).toEqual(['flow_executor_light', 'flow_executor_deep']);
    vi.mocked(console.log).mockClear();
    await runPlanShow({ cwd: tmpDir, agent: 'codex' });
    const out = logged().join('\n');
    expect(out).toContain('→ light (gpt-6-luna/low)');
    expect(out).toContain('→ deep (gpt-6.1-sol/high)');
  });

  it('a red gate names the next Codex executor', async () => {
    await setupPlan();
    const config = await fs.readJson(path.join(tmpDir, '.agent-flow', 'config.json'));
    config.orchestration.gates = { test: 'node -e "process.exit(1)"' };
    config.orchestration.defaultGates = ['test'];
    await fs.writeJson(path.join(tmpDir, '.agent-flow', 'config.json'), config);
    await runGateCommand({ cwd: tmpDir, task: '1.1' });
    await runGateCommand({ cwd: tmpDir, task: '1.1', json: true, agent: 'codex' });
    expect(JSON.parse(logged().at(-1) as string).nextExecutor).toMatchObject({ runtime: 'codex', agent: 'flow_executor', model: 'gpt-6.1-sol', escalated: true });
  });
});

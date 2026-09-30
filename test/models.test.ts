import path from 'node:path';
import os from 'node:os';
import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runInit } from '../src/commands/init.js';
import { runGateCommand, runNext } from '../src/commands/orchestrate.js';
import { runPlanShow } from '../src/commands/plan.js';
import {
  DEFAULT_MODEL_ROUTING,
  executorAssignment,
  getModelRouting,
  readTaskStats,
  recordGateOutcome,
  type TaskGateStats,
} from '../src/core/models.js';
import { emptyPlan, writePlan } from '../src/core/plan.js';
import type { Task } from '../src/core/plan-schema.js';
import { scoreTask } from '../src/core/router.js';

let tmpDir: string;

const PASS = 'node -e ""';
const FAIL = 'node -e "process.exit(1)"';

function task(partial: Partial<Task> & { id: string }): Task {
  return { title: partial.id, scope: [], wave: 1, dependsOn: [], status: 'pending', gates: [], acceptance: [], waives: [], ...partial };
}

const SMALL = task({ id: '1.1', title: 'rename label', scope: ['src/ui/label.ts'] });
const RISKY = task({
  id: '2.1',
  title: 'persist sessions and hash passwords',
  scope: ['src/auth/login.ts', 'src/auth/hash.ts', 'src/store/sessions.ts', 'src/store/db.ts'],
  acceptance: [
    { id: 'A1', text: 'passwords are hashed with a slow KDF', proof: 'test' },
    { id: 'A2', text: 'sessions survive restart', proof: 'test' },
    { id: 'H1', text: 'writes are atomic', proof: 'test' },
  ],
});

function stats(consecutiveFailures: number): TaskGateStats {
  return { runs: consecutiveFailures, failures: consecutiveFailures, consecutiveFailures, lastAt: '' };
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-flow-models-test-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  await fs.remove(tmpDir);
});

function logged(): string[] {
  return vi.mocked(console.log).mock.calls.map((call) => String(call[0]));
}

async function setOrchestration(root: string, patch: Record<string, unknown>): Promise<void> {
  const configPath = path.join(root, '.agent-flow', 'config.json');
  const config = await fs.readJson(configPath);
  config.orchestration = { ...config.orchestration, ...patch };
  await fs.writeJson(configPath, config, { spaces: 2 });
}

async function setupPlan(): Promise<void> {
  await runInit({ codex: true, cwd: tmpDir });
  await writePlan(tmpDir, {
    ...emptyPlan(new Date('2026-01-01T00:00:00.000Z')),
    phases: [{
      id: '1', title: 'P1', goal: '', requirements: [], dependsOn: [], status: 'pending',
      tasks: [
        { ...SMALL, gates: ['test'] },
        { ...RISKY, id: '1.2', gates: ['test'] },
      ],
    }],
  });
  vi.mocked(console.log).mockClear();
}

describe('deterministic router', () => {
  it('scores a small, plain task as light', () => {
    expect(scoreTask(SMALL)).toMatchObject({ tier: 'light', score: 0 });
  });

  it('scores a wide task touching auth + persistence as deep, with reasons', () => {
    const scored = scoreTask(RISKY);
    expect(scored.tier).toBe('deep');
    expect(scored.reasons.join(' ')).toMatch(/scope files/);
    expect(scored.reasons.join(' ')).toMatch(/domain packs: .*auth-secrets/);
    expect(scored.reasons.join(' ')).toMatch(/risky wording/);
    expect(scored.reasons.join(' ')).toMatch(/hardening criteria/);
  });

  it('treats an undeclared scope as some uncertainty', () => {
    expect(scoreTask(task({ id: '3.1', title: 'tidy' })).reasons).toContain('+1 no scope declared (uncertain footprint)');
  });

  it('waived packs do not raise the tier', () => {
    const waived = { ...RISKY, waives: ['auth-secrets', 'persistence'] };
    expect(scoreTask(waived).score).toBeLessThan(scoreTask(RISKY).score);
  });
});

describe('model routing', () => {
  it('has tiered defaults: haiku/low, sonnet/medium, sonnet/high, opus escalation', async () => {
    const routing = await getModelRouting(tmpDir);
    expect(routing).toEqual(DEFAULT_MODEL_ROUTING);
    expect(routing.tiers).toEqual({
      light: { model: 'haiku', effort: 'low' },
      standard: { model: 'sonnet', effort: 'medium' },
      deep: { model: 'sonnet', effort: 'high' },
    });
  });

  it('reads overrides, keeps models.executor as the standard tier, and ignores invalid values', async () => {
    await fs.ensureDir(path.join(tmpDir, '.agent-flow'));
    await fs.writeJson(path.join(tmpDir, '.agent-flow/config.json'), {
      orchestration: {
        models: { executor: 'opus', reviewer: '' },
        tiers: { light: { model: 'sonnet', effort: 'nope' } },
        router: { enabled: false },
        escalateAfterFailures: 0,
        contextBudgetTokens: -5,
      },
    });
    const routing = await getModelRouting(tmpDir);
    expect(routing.tiers.standard.model).toBe('opus');
    expect(routing.tiers.light).toEqual({ model: 'sonnet', effort: 'low' });
    expect(routing.router.enabled).toBe(false);
    expect(routing.reviewer).toBe('sonnet');
    expect(routing.escalateAfterFailures).toBe(0);
    expect(routing.contextBudgetTokens).toBe(DEFAULT_MODEL_ROUTING.contextBudgetTokens);
  });

  it('routes by task signals', () => {
    expect(executorAssignment(DEFAULT_MODEL_ROUTING, undefined, SMALL)).toMatchObject({ agent: 'flow-executor-light', model: 'haiku', effort: 'low', rung: 'light' });
    expect(executorAssignment(DEFAULT_MODEL_ROUTING, undefined, RISKY)).toMatchObject({ agent: 'flow-executor-deep', model: 'sonnet', effort: 'high', rung: 'deep' });
  });

  it('an explicit plan tier overrides the router', () => {
    expect(executorAssignment(DEFAULT_MODEL_ROUTING, undefined, { ...SMALL, tier: 'deep' })).toMatchObject({ tier: 'deep', reason: 'deep (plan sets tier deep)' });
  });

  it('uses the standard tier when the router is disabled', () => {
    const routing = { ...DEFAULT_MODEL_ROUTING, router: { ...DEFAULT_MODEL_ROUTING.router, enabled: false } };
    expect(executorAssignment(routing, undefined, SMALL)).toMatchObject({ agent: 'flow-executor', rung: 'standard' });
  });

  it('climbs one rung every escalateAfterFailures red attempts, up to the escalation model', () => {
    const r = DEFAULT_MODEL_ROUTING;
    expect(executorAssignment(r, stats(1), SMALL)).toMatchObject({ rung: 'light', escalated: false });
    expect(executorAssignment(r, stats(2), SMALL)).toMatchObject({ rung: 'standard', agent: 'flow-executor', model: 'sonnet', escalated: true });
    expect(executorAssignment(r, stats(4), SMALL)).toMatchObject({ rung: 'deep', agent: 'flow-executor-deep' });
    expect(executorAssignment(r, stats(6), SMALL)).toMatchObject({ rung: 'escalation', agent: 'flow-executor-deep', model: 'opus', effort: 'high' });
    expect(executorAssignment(r, stats(99), SMALL).rung).toBe('escalation');
    expect(executorAssignment(r, stats(2), RISKY)).toMatchObject({ rung: 'escalation', model: 'opus' });
  });

  it('never escalates when disabled', () => {
    const routing = { ...DEFAULT_MODEL_ROUTING, escalateAfterFailures: 0 };
    expect(executorAssignment(routing, stats(9), SMALL)).toMatchObject({ rung: 'light', escalated: false });
  });

  it('records consecutive failures and resets on green', async () => {
    await recordGateOutcome(tmpDir, '1.1', false);
    let s = await recordGateOutcome(tmpDir, '1.1', false);
    expect(s).toMatchObject({ runs: 2, failures: 2, consecutiveFailures: 2 });
    s = await recordGateOutcome(tmpDir, '1.1', true);
    expect(s.consecutiveFailures).toBe(0);
    expect((await readTaskStats(tmpDir))['1.1'].failures).toBe(2);
  });
});

describe('orchestration with routing', () => {
  it('next --brief prints a one-line dispatch record with the routed executor', async () => {
    await setupPlan();
    await runNext({ cwd: tmpDir, brief: true });
    const out = logged();
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0])).toEqual({
      task: '1.1',
      title: 'rename label',
      phase: '1',
      wave: 1,
      executor: { agent: 'flow-executor-light', model: 'haiku', effort: 'low', tier: 'light', escalated: false },
      envelope: 'agent-flow next --task 1.1 --json',
    });
  });

  it('next --task emits the envelope of a specific task with its routing reasons', async () => {
    await setupPlan();
    await runNext({ cwd: tmpDir, task: '1.2', json: true, peek: true });
    const envelope = JSON.parse(logged()[0]);
    expect(envelope.task.id).toBe('1.2');
    expect(envelope.executor).toMatchObject({ agent: 'flow-executor-deep', rung: 'deep' });
    expect(envelope.executor.reasons.length).toBeGreaterThan(0);
  });

  it('next --wave --brief lists the batch compactly', async () => {
    await setupPlan();
    await runNext({ cwd: tmpDir, wave: true, brief: true, peek: true });
    const record = JSON.parse(logged()[0]);
    expect(record.batch.map((b: { task: string }) => b.task)).toEqual(['1.1', '1.2']);
    expect(record.batch.map((b: { executor: { agent: string } }) => b.executor.agent)).toEqual(['flow-executor-light', 'flow-executor-deep']);
    expect(record.batch[0]).not.toHaveProperty('contextPack');
  });

  it('red gates climb the ladder for that task only', async () => {
    await setupPlan();
    await setOrchestration(tmpDir, { gates: { test: FAIL }, defaultGates: ['test'] });

    await runGateCommand({ cwd: tmpDir, task: '1.1' });
    await runGateCommand({ cwd: tmpDir, task: '1.1', json: true });
    expect(JSON.parse(logged().at(-1) as string).nextExecutor).toMatchObject({ agent: 'flow-executor', model: 'sonnet', escalated: true });

    vi.mocked(console.log).mockClear();
    await runNext({ cwd: tmpDir, task: '1.2', brief: true, peek: true });
    expect(JSON.parse(logged()[0]).executor).toMatchObject({ agent: 'flow-executor-deep', escalated: false });
  });

  it('gate --no-record does not count toward escalation', async () => {
    await setupPlan();
    await setOrchestration(tmpDir, { gates: { test: FAIL }, defaultGates: ['test'] });
    await runGateCommand({ cwd: tmpDir, task: '1.1', record: false });
    await runGateCommand({ cwd: tmpDir, task: '1.1', record: false });
    await runGateCommand({ cwd: tmpDir, task: '1.1', record: false, json: true });
    expect(JSON.parse(logged().at(-1) as string).nextExecutor).toMatchObject({ agent: 'flow-executor-light', escalated: false });
    expect((await readTaskStats(tmpDir))['1.1']).toBeUndefined();
  });

  it('plan show previews each pending task\'s route', async () => {
    await setupPlan();
    await runPlanShow({ cwd: tmpDir });
    const out = logged().join('\n');
    expect(out).toContain('rename label');
    expect(out).toMatch(/1\.1 \(wave 1\) rename label.*light \(haiku\/low\)/);
    expect(out).toMatch(/1\.2 .*deep \(sonnet\/high\)/);
  });

  it('reports an unknown --task', async () => {
    await setupPlan();
    await runNext({ cwd: tmpDir, task: '9.9' });
    expect(logged().join('\n')).toContain('task 9.9 not found');
  });
});

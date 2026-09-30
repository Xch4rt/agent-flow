import path from 'node:path';
import os from 'node:os';
import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runInit } from '../src/commands/init.js';
import { runGateCommand, runNext } from '../src/commands/orchestrate.js';
import {
  DEFAULT_MODEL_ROUTING,
  executorAssignment,
  getModelRouting,
  readTaskStats,
  recordGateOutcome,
} from '../src/core/models.js';
import { emptyPlan, writePlan } from '../src/core/plan.js';

let tmpDir: string;

const PASS = 'node -e ""';
const FAIL = 'node -e "process.exit(1)"';

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-flow-models-test-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
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
        { id: '1.1', title: 'first', scope: ['src/a.ts'], wave: 1, dependsOn: [], status: 'pending', gates: ['test'], acceptance: [] },
        { id: '1.2', title: 'second', scope: ['src/b.ts'], wave: 1, dependsOn: [], status: 'pending', gates: ['test'], acceptance: [] },
      ],
    }],
  });
  vi.mocked(console.log).mockClear();
}

describe('model routing', () => {
  it('defaults to mid-tier roles with opus escalation', async () => {
    expect(await getModelRouting(tmpDir)).toEqual(DEFAULT_MODEL_ROUTING);
  });

  it('reads overrides and ignores invalid values', async () => {
    await fs.ensureDir(path.join(tmpDir, '.agent-flow'));
    await fs.writeJson(path.join(tmpDir, '.agent-flow/config.json'), {
      orchestration: { models: { executor: 'haiku', reviewer: '' }, escalateAfterFailures: 0, contextBudgetTokens: -5 },
    });
    const routing = await getModelRouting(tmpDir);
    expect(routing.executor).toBe('haiku');
    expect(routing.reviewer).toBe('sonnet');
    expect(routing.escalateAfterFailures).toBe(0);
    expect(routing.contextBudgetTokens).toBe(DEFAULT_MODEL_ROUTING.contextBudgetTokens);
  });

  it('escalates after consecutive failures and resets on green', async () => {
    await recordGateOutcome(tmpDir, '1.1', false);
    let stats = await recordGateOutcome(tmpDir, '1.1', false);
    expect(stats).toMatchObject({ runs: 2, failures: 2, consecutiveFailures: 2 });
    expect(executorAssignment(DEFAULT_MODEL_ROUTING, stats)).toMatchObject({ model: 'opus', escalated: true });

    stats = await recordGateOutcome(tmpDir, '1.1', true);
    expect(stats.consecutiveFailures).toBe(0);
    expect(executorAssignment(DEFAULT_MODEL_ROUTING, stats)).toMatchObject({ model: 'sonnet', escalated: false });
    expect((await readTaskStats(tmpDir))['1.1'].failures).toBe(2);
  });

  it('never escalates when disabled', () => {
    const routing = { ...DEFAULT_MODEL_ROUTING, escalateAfterFailures: 0 };
    expect(executorAssignment(routing, { runs: 9, failures: 9, consecutiveFailures: 9, lastAt: '' }).model).toBe('sonnet');
  });
});

describe('orchestration with routing', () => {
  it('next --brief prints a one-line dispatch record with the executor model', async () => {
    await setupPlan();
    await setOrchestration(tmpDir, { gates: { test: PASS }, defaultGates: ['test'] });

    await runNext({ cwd: tmpDir, brief: true });
    const out = logged();
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0])).toEqual({
      task: '1.1',
      title: 'first',
      phase: '1',
      wave: 1,
      executor: { agent: 'flow-executor', model: 'sonnet', escalated: false },
      envelope: 'agent-flow next --task 1.1 --json',
    });
  });

  it('next --task emits the envelope of a specific task', async () => {
    await setupPlan();
    await runNext({ cwd: tmpDir, task: '1.2', json: true, peek: true });
    const envelope = JSON.parse(logged()[0]);
    expect(envelope.task.id).toBe('1.2');
    expect(envelope.executor).toMatchObject({ agent: 'flow-executor', model: 'sonnet' });
  });

  it('next --wave --brief lists the batch compactly', async () => {
    await setupPlan();
    await runNext({ cwd: tmpDir, wave: true, brief: true, peek: true });
    const record = JSON.parse(logged()[0]);
    expect(record.batch.map((b: { task: string }) => b.task)).toEqual(['1.1', '1.2']);
    expect(record.batch[0]).not.toHaveProperty('contextPack');
  });

  it('red gates escalate the next executor for that task only', async () => {
    await setupPlan();
    await setOrchestration(tmpDir, { gates: { test: FAIL }, defaultGates: ['test'] });

    await runGateCommand({ cwd: tmpDir, task: '1.1' });
    await runGateCommand({ cwd: tmpDir, task: '1.1', json: true });
    const gateJson = JSON.parse(logged().at(-1) as string);
    expect(gateJson.nextExecutor).toMatchObject({ model: 'opus', escalated: true });
    process.exitCode = 0;

    vi.mocked(console.log).mockClear();
    await runNext({ cwd: tmpDir, task: '1.1', brief: true, peek: true });
    expect(JSON.parse(logged()[0]).executor).toMatchObject({ model: 'opus', escalated: true });

    vi.mocked(console.log).mockClear();
    await runNext({ cwd: tmpDir, task: '1.2', brief: true, peek: true });
    expect(JSON.parse(logged()[0]).executor).toMatchObject({ model: 'sonnet', escalated: false });
  });

  it('gate --no-record does not count toward escalation', async () => {
    await setupPlan();
    await setOrchestration(tmpDir, { gates: { test: FAIL }, defaultGates: ['test'] });
    await runGateCommand({ cwd: tmpDir, task: '1.1', record: false });
    await runGateCommand({ cwd: tmpDir, task: '1.1', record: false });
    await runGateCommand({ cwd: tmpDir, task: '1.1', record: false, json: true });
    expect(JSON.parse(logged().at(-1) as string).nextExecutor).toMatchObject({ model: 'sonnet', escalated: false });
    expect((await readTaskStats(tmpDir))['1.1']).toBeUndefined();
    process.exitCode = 0;
  });

  it('reports an unknown --task', async () => {
    await setupPlan();
    await runNext({ cwd: tmpDir, task: '9.9' });
    expect(logged().join('\n')).toContain('task 9.9 not found');
    process.exitCode = 0;
  });
});

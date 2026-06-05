import path from 'node:path';
import os from 'node:os';
import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runInit } from '../src/commands/init.js';
import { runNext, runGateCommand, runAdvance } from '../src/commands/orchestrate.js';
import { execa } from 'execa';
import { resolveGateCommands, runGates, worktreeSignature } from '../src/core/gates.js';
import { emptyPlan, loadPlan, writePlan } from '../src/core/plan.js';
import type { Plan } from '../src/core/plan-schema.js';

let tmpDir: string;

const PASS = 'node -e ""';
const FAIL = 'node -e "process.exit(1)"';

async function setGates(root: string, gates: Record<string, string>): Promise<void> {
  const configPath = path.join(root, '.agent-flow', 'config.json');
  const config = await fs.readJson(configPath);
  config.orchestration = { gates, defaultGates: ['test'] };
  await fs.writeJson(configPath, config, { spaces: 2 });
}

function twoTaskPlan(): Plan {
  return {
    ...emptyPlan(new Date('2026-01-01T00:00:00.000Z')),
    phases: [
      {
        id: '1', title: 'P1', goal: '', requirements: [], dependsOn: [], status: 'pending',
        tasks: [
          { id: '1.1', title: 'first', scope: ['src/a.ts'], wave: 1, dependsOn: [], status: 'pending', gates: ['test'], acceptance: [] },
          { id: '1.2', title: 'second', scope: [], wave: 2, dependsOn: ['1.1'], status: 'pending', gates: ['test'], acceptance: [] },
        ],
      },
    ],
  };
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-flow-orch-test-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  process.exitCode = 0;
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  await fs.remove(tmpDir);
});

describe('gate resolution', () => {
  it('config orchestration.gates overrides detected commands', async () => {
    await runInit({ codex: true, cwd: tmpDir });
    await fs.writeJson(path.join(tmpDir, 'package.json'), { scripts: { test: 'vitest' } });
    await setGates(tmpDir, { test: PASS });
    const commands = await resolveGateCommands(tmpDir);
    expect(commands.test).toBe(PASS);
  });
});

describe('runGates', () => {
  it('passes when the command exits 0 and fails when it exits non-zero', async () => {
    await runInit({ codex: true, cwd: tmpDir });
    await setGates(tmpDir, { test: PASS, broken: FAIL });
    expect((await runGates(tmpDir, ['test'])).ok).toBe(true);
    expect((await runGates(tmpDir, ['broken'])).ok).toBe(false);
  });

  it('skips (does not fail) a gate with no resolved command', async () => {
    await runInit({ codex: true, cwd: tmpDir });
    await setGates(tmpDir, {});
    const run = await runGates(tmpDir, ['nonexistent']);
    expect(run.ok).toBe(true);
    expect(run.results[0].skipped).toBe(true);
  });
});

describe('worktreeSignature', () => {
  it('ignores .agent-flow bookkeeping but reflects source changes', async () => {
    await execa('git', ['init', '-q'], { cwd: tmpDir });
    await execa('git', ['config', 'user.email', 't@t.dev'], { cwd: tmpDir });
    await execa('git', ['config', 'user.name', 'T'], { cwd: tmpDir });
    await fs.ensureDir(path.join(tmpDir, 'src'));
    await fs.writeFile(path.join(tmpDir, 'src/a.ts'), 'export const a = 1;\n');

    const before = await worktreeSignature(tmpDir);

    // Writing agent-flow's own files must NOT change the signature.
    await fs.ensureDir(path.join(tmpDir, '.agent-flow'));
    await fs.writeJson(path.join(tmpDir, '.agent-flow/gate-cache.json'), { ok: true });
    expect(await worktreeSignature(tmpDir)).toBe(before);

    // Changing source MUST change the signature.
    await fs.writeFile(path.join(tmpDir, 'src/a.ts'), 'export const a = 2;\n');
    expect(await worktreeSignature(tmpDir)).not.toBe(before);
  });
});

describe('next / gate / advance loop', () => {
  it('next marks the chosen task active', async () => {
    await runInit({ codex: true, cwd: tmpDir });
    await setGates(tmpDir, { test: PASS });
    await writePlan(tmpDir, twoTaskPlan());

    await runNext({ cwd: tmpDir });

    const loaded = await loadPlan(tmpDir);
    if (loaded.exists && loaded.valid) {
      expect(loaded.plan.phases[0].tasks[0].status).toBe('active');
    } else {
      throw new Error('plan not valid');
    }
  });

  it('advance is blocked without a passing gate (the gate is a hard gate)', async () => {
    await runInit({ codex: true, cwd: tmpDir });
    await setGates(tmpDir, { test: PASS });
    await writePlan(tmpDir, twoTaskPlan());

    await runAdvance({ cwd: tmpDir, task: '1.1' }); // no gate run yet

    expect(process.exitCode).toBe(1);
    const loaded = await loadPlan(tmpDir);
    if (loaded.exists && loaded.valid) {
      expect(loaded.plan.phases[0].tasks[0].status).not.toBe('done');
    }
  });

  it('gate then advance completes a task and appends a memory event', async () => {
    await runInit({ codex: true, cwd: tmpDir });
    await setGates(tmpDir, { test: PASS });
    await writePlan(tmpDir, twoTaskPlan());

    await runGateCommand({ cwd: tmpDir, task: '1.1' });
    expect(process.exitCode).toBe(0);

    await runAdvance({ cwd: tmpDir, task: '1.1' });

    const loaded = await loadPlan(tmpDir);
    if (loaded.exists && loaded.valid) {
      expect(loaded.plan.phases[0].tasks[0].status).toBe('done');
      expect(loaded.plan.cursor.task).toBe('1.2');
    }
    const events = (await fs.readFile(path.join(tmpDir, '.memory/events.jsonl'), 'utf8')).trim();
    expect(events).not.toBe('');
    expect(JSON.parse(events.split('\n').pop() as string)).toMatchObject({ type: 'change' });
  });

  it('advance --gate runs gates in one shot', async () => {
    await runInit({ codex: true, cwd: tmpDir });
    await setGates(tmpDir, { test: PASS });
    await writePlan(tmpDir, twoTaskPlan());

    await runAdvance({ cwd: tmpDir, task: '1.1', gate: true });

    const loaded = await loadPlan(tmpDir);
    if (loaded.exists && loaded.valid) {
      expect(loaded.plan.phases[0].tasks[0].status).toBe('done');
    }
    expect(process.exitCode).toBe(0);
  });

  it('advance --gate is blocked when gates fail', async () => {
    await runInit({ codex: true, cwd: tmpDir });
    await setGates(tmpDir, { test: FAIL });
    await writePlan(tmpDir, twoTaskPlan());

    await runAdvance({ cwd: tmpDir, task: '1.1', gate: true });

    expect(process.exitCode).toBe(1);
    const loaded = await loadPlan(tmpDir);
    if (loaded.exists && loaded.valid) {
      expect(loaded.plan.phases[0].tasks[0].status).not.toBe('done');
    }
  });

  it('full walk: advance both tasks completes the phase', async () => {
    await runInit({ codex: true, cwd: tmpDir });
    await setGates(tmpDir, { test: PASS });
    await writePlan(tmpDir, twoTaskPlan());

    await runAdvance({ cwd: tmpDir, task: '1.1', gate: true });
    await runAdvance({ cwd: tmpDir, task: '1.2', gate: true });

    const loaded = await loadPlan(tmpDir);
    if (loaded.exists && loaded.valid) {
      expect(loaded.plan.phases[0].status).toBe('done');
      expect(loaded.plan.cursor.task).toBeNull();
    }
  });
});

import path from 'node:path';
import os from 'node:os';
import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runInit } from '../src/commands/init.js';
import { runNext } from '../src/commands/orchestrate.js';
import { conflictFreeBatch, emptyPlan, nextWave, writePlan } from '../src/core/plan.js';
import type { Phase, Plan, Task } from '../src/core/plan-schema.js';

let tmpDir: string;

function task(id: string, wave: number, scope: string[], dependsOn: string[] = [], status: Task['status'] = 'pending'): Task {
  return { id, title: `task ${id}`, scope, wave, dependsOn, status, gates: ['test'], acceptance: [] };
}

function phase(id: string, tasks: Task[], dependsOn: string[] = [], status: Phase['status'] = 'pending'): Phase {
  return { id, title: `P${id}`, goal: '', requirements: [], dependsOn, status, tasks };
}

function planOf(phases: Phase[]): Plan {
  return { ...emptyPlan(new Date('2026-01-01T00:00:00.000Z')), phases };
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-flow-fanout-test-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  process.exitCode = 0;
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  await fs.remove(tmpDir);
});

describe('nextWave', () => {
  it('returns all actionable tasks at the lowest open wave of the earliest open phase', () => {
    const plan = planOf([
      phase('1', [
        task('1.1', 1, ['src/a.ts']),
        task('1.2', 1, ['src/b.ts']),
        task('1.3', 2, ['src/c.ts'], ['1.1', '1.2']),
      ]),
      phase('2', [task('2.1', 1, ['src/d.ts'])], ['1']),
    ]);

    const wave = nextWave(plan);
    expect(wave?.wave).toBe(1);
    expect(wave?.tasks.map((t) => t.task.id).sort()).toEqual(['1.1', '1.2']);
    // phase 2 must not be reached while phase 1 is open
    expect(wave?.tasks.every((t) => t.phase.id === '1')).toBe(true);
  });

  it('advances to the next wave once earlier-wave tasks are done', () => {
    const plan = planOf([
      phase('1', [
        task('1.1', 1, ['src/a.ts'], [], 'done'),
        task('1.2', 1, ['src/b.ts'], [], 'done'),
        task('1.3', 2, ['src/c.ts'], ['1.1', '1.2']),
      ], [], 'active'),
    ]);
    const wave = nextWave(plan);
    expect(wave?.wave).toBe(2);
    expect(wave?.tasks.map((t) => t.task.id)).toEqual(['1.3']);
  });
});

describe('conflictFreeBatch', () => {
  it('holds back tasks whose scope overlaps an already-batched task', () => {
    const p = phase('1', []);
    const items = [
      { phase: p, task: task('a', 1, ['src/x.ts']) },
      { phase: p, task: task('b', 1, ['src/y.ts']) },
      { phase: p, task: task('c', 1, ['src/x.ts']) }, // conflicts with a
    ];
    const { batch, heldBack } = conflictFreeBatch(items);
    expect(batch.map((i) => i.task.id)).toEqual(['a', 'b']);
    expect(heldBack.map((i) => i.task.id)).toEqual(['c']);
    expect(heldBack[0].file).toBe('src/x.ts');
  });

  it('batches all tasks when scopes are disjoint', () => {
    const p = phase('1', []);
    const items = [
      { phase: p, task: task('a', 1, ['src/x.ts']) },
      { phase: p, task: task('b', 1, ['src/y.ts']) },
    ];
    expect(conflictFreeBatch(items).heldBack).toHaveLength(0);
  });
});

describe('next --wave', () => {
  it('emits one envelope per parallel task and reports held-back overlaps', async () => {
    await runInit({ codex: true, cwd: tmpDir });
    await writePlan(tmpDir, planOf([
      phase('1', [
        task('1.1', 1, ['src/a.ts']),
        task('1.2', 1, ['src/b.ts']),
        task('1.3', 1, ['src/a.ts']), // overlaps 1.1
      ]),
    ]));

    const logs: string[] = [];
    (console.log as unknown as ReturnType<typeof vi.fn>).mockImplementation((m?: unknown) => { logs.push(String(m)); });

    await runNext({ cwd: tmpDir, wave: true, json: true });

    const out = JSON.parse(logs.join('\n'));
    expect(out.wave).toBe(1);
    expect(out.batch.map((e: { task: { id: string } }) => e.task.id).sort()).toEqual(['1.1', '1.2']);
    expect(out.heldBack[0]).toMatchObject({ task: '1.3', conflictFile: 'src/a.ts' });
  });

  it('marks the batched tasks active', async () => {
    await runInit({ codex: true, cwd: tmpDir });
    await writePlan(tmpDir, planOf([
      phase('1', [task('1.1', 1, ['src/a.ts']), task('1.2', 1, ['src/b.ts'])]),
    ]));

    await runNext({ cwd: tmpDir, wave: true });

    const { loadPlan } = await import('../src/core/plan.js');
    const loaded = await loadPlan(tmpDir);
    if (loaded.exists && loaded.valid) {
      expect(loaded.plan.phases[0].tasks.every((t) => t.status === 'active')).toBe(true);
    }
  });
});

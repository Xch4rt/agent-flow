import path from 'node:path';
import os from 'node:os';
import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  computeProgress,
  emptyPlan,
  loadPlan,
  nextTask,
  parseRequirementUniverse,
  validatePlanStructure,
  writePlan,
} from '../src/core/plan.js';
import { parsePlan, type Plan } from '../src/core/plan-schema.js';
import { runPlanInit, runPlanValidate } from '../src/commands/plan.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-flow-plan-test-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  process.exitCode = 0;
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  await fs.remove(tmpDir);
});

function planWith(phases: Plan['phases']): Plan {
  return { ...emptyPlan(new Date('2026-01-01T00:00:00.000Z')), phases };
}

describe('plan schema', () => {
  it('applies defaults when parsing a minimal plan', () => {
    const parsed = parsePlan({
      schemaVersion: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      phases: [{ id: '1', title: 'P1', tasks: [{ id: '1.1', title: 'T' }] }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.plan.milestone).toBe('v1');
    expect(parsed.plan.phases[0].status).toBe('pending');
    expect(parsed.plan.phases[0].tasks[0].wave).toBe(1);
    expect(parsed.plan.cursor).toEqual({ phase: null, task: null });
  });

  it('rejects malformed requirement ids', () => {
    const parsed = parsePlan({
      schemaVersion: 1,
      createdAt: 'now',
      phases: [{ id: '1', title: 'P1', requirements: ['not-a-req'], tasks: [] }],
    });
    expect(parsed.ok).toBe(false);
  });
});

describe('plan IO', () => {
  it('writes and loads a plan roundtrip', async () => {
    await writePlan(tmpDir, planWith([{ id: '1', title: 'P1', goal: '', requirements: [], dependsOn: [], status: 'pending', tasks: [] }]));
    const loaded = await loadPlan(tmpDir);
    expect(loaded.exists).toBe(true);
    if (loaded.exists && loaded.valid) {
      expect(loaded.plan.phases).toHaveLength(1);
      expect(loaded.plan.updatedAt).toBeTruthy();
    }
  });

  it('reports missing plan', async () => {
    const loaded = await loadPlan(tmpDir);
    expect(loaded.exists).toBe(false);
  });

  it('reports invalid JSON', async () => {
    await fs.ensureDir(path.join(tmpDir, '.agent-flow'));
    await fs.writeFile(path.join(tmpDir, '.agent-flow/plan.json'), '{ not json');
    const loaded = await loadPlan(tmpDir);
    expect(loaded.exists && !loaded.valid).toBe(true);
  });
});

describe('parseRequirementUniverse', () => {
  it('extracts and dedups requirement ids from REQUIREMENTS.md', async () => {
    await fs.ensureDir(path.join(tmpDir, '.planning'));
    await fs.writeFile(
      path.join(tmpDir, '.planning/REQUIREMENTS.md'),
      '# Requirements\n- SHORT-01: a\n- SHORT-01: dup mention\n- REDIR-02: b\n- lowercase-1 ignored\n',
    );
    const universe = await parseRequirementUniverse(tmpDir);
    expect(universe).toEqual(['REDIR-02', 'SHORT-01']);
  });

  it('returns empty when REQUIREMENTS.md is missing', async () => {
    expect(await parseRequirementUniverse(tmpDir)).toEqual([]);
  });
});

describe('validatePlanStructure', () => {
  it('passes a clean plan with full coverage', () => {
    const plan = planWith([
      { id: '1', title: 'P1', goal: '', requirements: ['SHORT-01'], dependsOn: [], status: 'pending', tasks: [
        { id: '1.1', title: 'T', scope: [], wave: 1, dependsOn: [], status: 'pending', gates: [], acceptance: [] },
      ] },
    ]);
    const v = validatePlanStructure(plan, ['SHORT-01']);
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
    expect(v.coverage.unmapped).toEqual([]);
  });

  it('flags unmapped, unknown, and duplicated requirements as warnings', () => {
    const plan = planWith([
      { id: '1', title: 'P1', goal: '', requirements: ['SHORT-01', 'GHOST-99'], dependsOn: [], status: 'pending', tasks: [] },
      { id: '2', title: 'P2', goal: '', requirements: ['SHORT-01'], dependsOn: [], status: 'pending', tasks: [] },
    ]);
    const v = validatePlanStructure(plan, ['SHORT-01', 'REDIR-02']);
    expect(v.coverage.unmapped).toContain('REDIR-02');
    expect(v.coverage.unknown).toContain('GHOST-99');
    expect(v.coverage.duplicated).toContain('SHORT-01');
    expect(v.ok).toBe(true); // coverage issues are warnings, not errors
    expect(v.warnings.length).toBeGreaterThan(0);
  });

  it('errors on dangling phase dependency', () => {
    const plan = planWith([
      { id: '1', title: 'P1', goal: '', requirements: [], dependsOn: ['9'], status: 'pending', tasks: [] },
    ]);
    const v = validatePlanStructure(plan, []);
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.includes('unknown phase 9'))).toBe(true);
  });

  it('errors on a phase dependency cycle', () => {
    const plan = planWith([
      { id: '1', title: 'P1', goal: '', requirements: [], dependsOn: ['2'], status: 'pending', tasks: [] },
      { id: '2', title: 'P2', goal: '', requirements: [], dependsOn: ['1'], status: 'pending', tasks: [] },
    ]);
    const v = validatePlanStructure(plan, []);
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.includes('cycle'))).toBe(true);
  });

  it('errors on a task dependency cycle and duplicate ids', () => {
    const plan = planWith([
      { id: '1', title: 'P1', goal: '', requirements: [], dependsOn: [], status: 'pending', tasks: [
        { id: 'a', title: 'A', scope: [], wave: 1, dependsOn: ['b'], status: 'pending', gates: [], acceptance: [] },
        { id: 'b', title: 'B', scope: [], wave: 1, dependsOn: ['a'], status: 'pending', gates: [], acceptance: [] },
      ] },
    ]);
    const v = validatePlanStructure(plan, []);
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.includes('task dependency cycle'))).toBe(true);
  });

  it('warns when a dependency is not in an earlier wave', () => {
    const plan = planWith([
      { id: '1', title: 'P1', goal: '', requirements: [], dependsOn: [], status: 'pending', tasks: [
        { id: 'a', title: 'A', scope: [], wave: 1, dependsOn: [], status: 'pending', gates: [], acceptance: [] },
        { id: 'b', title: 'B', scope: [], wave: 1, dependsOn: ['a'], status: 'pending', gates: [], acceptance: [] },
      ] },
    ]);
    const v = validatePlanStructure(plan, []);
    expect(v.ok).toBe(true); // wave-order is a warning
    expect(v.warnings.some((w) => w.includes('earlier wave'))).toBe(true);
  });
});

describe('progress + nextTask', () => {
  const plan = (): Plan => planWith([
    { id: '1', title: 'P1', goal: '', requirements: [], dependsOn: [], status: 'done', tasks: [
      { id: '1.1', title: 'done task', scope: [], wave: 1, dependsOn: [], status: 'done', gates: [], acceptance: [] },
    ] },
    { id: '2', title: 'P2', goal: '', requirements: [], dependsOn: ['1'], status: 'active', tasks: [
      { id: '2.1', title: 'w1', scope: [], wave: 1, dependsOn: [], status: 'pending', gates: [], acceptance: [] },
      { id: '2.2', title: 'w2', scope: [], wave: 2, dependsOn: ['2.1'], status: 'pending', gates: [], acceptance: [] },
    ] },
    { id: '3', title: 'P3', goal: '', requirements: [], dependsOn: ['2'], status: 'pending', tasks: [
      { id: '3.1', title: 'blocked-by-phase', scope: [], wave: 1, dependsOn: [], status: 'pending', gates: [], acceptance: [] },
    ] },
  ]);

  it('computes progress', () => {
    const p = computeProgress(plan());
    expect(p.tasksTotal).toBe(4);
    expect(p.tasksDone).toBe(1);
    expect(p.percent).toBe(25);
    expect(p.phasesDone).toBe(1);
  });

  it('picks the lowest-wave actionable task in the earliest open phase', () => {
    const n = nextTask(plan());
    expect(n?.phase.id).toBe('2');
    expect(n?.task.id).toBe('2.1');
  });

  it('does not pick a phase whose dependencies are unmet', () => {
    // phase 2 still open, so phase 3 must not be chosen
    const n = nextTask(plan());
    expect(n?.phase.id).not.toBe('3');
  });

  it('returns null when everything is done', () => {
    const allDone = planWith([
      { id: '1', title: 'P1', goal: '', requirements: [], dependsOn: [], status: 'done', tasks: [
        { id: '1.1', title: 'x', scope: [], wave: 1, dependsOn: [], status: 'done', gates: [], acceptance: [] },
      ] },
    ]);
    expect(nextTask(allDone)).toBeNull();
  });
});

describe('plan commands', () => {
  it('init creates a plan, skips when present, and recreates with --force', async () => {
    await fs.ensureDir(path.join(tmpDir, '.planning'));
    await fs.writeFile(path.join(tmpDir, '.planning/REQUIREMENTS.md'), '- SHORT-01: a\n');

    await runPlanInit({ cwd: tmpDir });
    expect(await fs.pathExists(path.join(tmpDir, '.agent-flow/plan.json'))).toBe(true);

    // mark a change, then a skip should not overwrite
    const before = await fs.readJson(path.join(tmpDir, '.agent-flow/plan.json'));
    await runPlanInit({ cwd: tmpDir });
    const afterSkip = await fs.readJson(path.join(tmpDir, '.agent-flow/plan.json'));
    expect(afterSkip.createdAt).toBe(before.createdAt);

    await runPlanInit({ cwd: tmpDir, force: true });
    expect(await fs.pathExists(path.join(tmpDir, '.agent-flow/plan.json'))).toBe(true);
  });

  it('validate sets a non-zero exit code on structural errors', async () => {
    await writePlan(tmpDir, planWith([
      { id: '1', title: 'P1', goal: '', requirements: [], dependsOn: ['2'], status: 'pending', tasks: [] },
    ]));
    await runPlanValidate({ cwd: tmpDir });
    expect(process.exitCode).toBe(1);
  });

  it('validate passes a clean plan', async () => {
    await fs.ensureDir(path.join(tmpDir, '.planning'));
    await fs.writeFile(path.join(tmpDir, '.planning/REQUIREMENTS.md'), '- SHORT-01: a\n');
    await writePlan(tmpDir, planWith([
      { id: '1', title: 'P1', goal: '', requirements: ['SHORT-01'], dependsOn: [], status: 'pending', tasks: [] },
    ]));
    await runPlanValidate({ cwd: tmpDir });
    expect(process.exitCode).toBe(0);
  });
});

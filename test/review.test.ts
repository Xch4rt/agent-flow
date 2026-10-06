import path from 'node:path';
import os from 'node:os';
import fs from 'fs-extra';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runInit } from '../src/commands/init.js';
import { runAdvance } from '../src/commands/orchestrate.js';
import { runReviewEmit, runReviewRecord } from '../src/commands/review.js';
import { emptyPlan, writePlan, loadPlan } from '../src/core/plan.js';
import { reviewStatus, readReviewRecord, type ReviewRecord } from '../src/core/review.js';
import type { Plan } from '../src/core/plan-schema.js';
import { parsePorcelainZ, worktreeSignature } from '../src/core/gates.js';

let tmpDir: string;
const PASS = 'node -e ""';

async function setOrchestration(root: string, orchestration: Record<string, unknown>): Promise<void> {
  const configPath = path.join(root, '.agent-flow', 'config.json');
  const config = await fs.readJson(configPath);
  config.orchestration = orchestration;
  await fs.writeJson(configPath, config, { spaces: 2 });
}

function twoTaskPhasePlan(): Plan {
  return {
    ...emptyPlan(new Date('2026-01-01T00:00:00.000Z')),
    phases: [
      {
        id: '1', title: 'P1', goal: 'do the thing', requirements: [], dependsOn: [], status: 'pending',
        tasks: [
          { id: '1.1', title: 'first', scope: ['src/a.ts'], wave: 1, dependsOn: [], status: 'pending', gates: ['test'], acceptance: [{ id: 'ac1', text: 'works', proof: 'test' }] },
          { id: '1.2', title: 'second', scope: ['src/b.ts'], wave: 2, dependsOn: ['1.1'], status: 'pending', gates: ['test'], acceptance: [] },
        ],
      },
    ],
  };
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-flow-review-test-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  process.exitCode = 0;
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  await fs.remove(tmpDir);
});

describe('reviewStatus', () => {
  const base: ReviewRecord = { phase: '1', signature: 'sig-a', verdict: 'pass', at: 'now' };
  it('classifies missing/stale/fail/pass', () => {
    expect(reviewStatus(null, 'sig-a')).toBe('missing');
    expect(reviewStatus({ ...base, signature: 'other' }, 'sig-a')).toBe('stale');
    expect(reviewStatus({ ...base, verdict: 'fail' }, 'sig-a')).toBe('fail');
    expect(reviewStatus(base, 'sig-a')).toBe('pass');
  });
});

describe('review record/emit commands', () => {
  it('emit returns an envelope with acceptance, scope files, and rubric', async () => {
    await runInit({ codex: true, cwd: tmpDir });
    await writePlan(tmpDir, twoTaskPhasePlan());
    const logs: string[] = [];
    (console.log as unknown as ReturnType<typeof vi.fn>).mockImplementation((m?: unknown) => { logs.push(String(m)); });
    await runReviewEmit({ cwd: tmpDir, phase: '1', json: true });
    const envelope = JSON.parse(logs.join('\n'));
    expect(envelope.phase.id).toBe('1');
    expect(envelope.acceptance[0].id).toBe('ac1');
    expect(envelope.scopeFiles).toContain('src/a.ts');
    expect(Array.isArray(envelope.rubric)).toBe(true);
  });

  it('record rejects an invalid verdict', async () => {
    await runInit({ codex: true, cwd: tmpDir });
    await writePlan(tmpDir, twoTaskPhasePlan());
    await runReviewRecord({ cwd: tmpDir, phase: '1', verdict: 'maybe' });
    expect(process.exitCode).toBe(1);
  });

  it('record writes a verdict keyed to the current signature', async () => {
    await runInit({ codex: true, cwd: tmpDir });
    await writePlan(tmpDir, twoTaskPhasePlan());
    await runReviewRecord({ cwd: tmpDir, phase: '1', verdict: 'pass', notes: 'looks good' });
    const record = await readReviewRecord(tmpDir, '1');
    expect(record?.verdict).toBe('pass');
    expect(record?.notes).toBe('looks good');
  });
});

describe('advance tier-1 review gate', () => {
  it('blocks closing a phase until a passing review is recorded', async () => {
    await runInit({ codex: true, cwd: tmpDir });
    await setOrchestration(tmpDir, { gates: { test: PASS }, defaultGates: ['test'], review: { tier: 1 } });
    await writePlan(tmpDir, twoTaskPhasePlan());

    // First task does not close the phase → no review required.
    await runAdvance({ cwd: tmpDir, task: '1.1', gate: true });
    expect(process.exitCode).toBe(0);

    // Last task would close the phase → review required, none recorded → blocked.
    await runAdvance({ cwd: tmpDir, task: '1.2', gate: true });
    expect(process.exitCode).toBe(1);
    let loaded = await loadPlan(tmpDir);
    if (loaded.exists && loaded.valid) expect(loaded.plan.phases[0].tasks[1].status).not.toBe('done');

    // Record a passing review, then the phase can close.
    process.exitCode = 0;
    await runReviewRecord({ cwd: tmpDir, phase: '1', verdict: 'pass' });
    await runAdvance({ cwd: tmpDir, task: '1.2', gate: true });
    expect(process.exitCode).toBe(0);
    loaded = await loadPlan(tmpDir);
    if (loaded.exists && loaded.valid) {
      expect(loaded.plan.phases[0].tasks[1].status).toBe('done');
      expect(loaded.plan.phases[0].status).toBe('done');
    }
  });

  it('a failing review keeps the phase closed-off', async () => {
    await runInit({ codex: true, cwd: tmpDir });
    await setOrchestration(tmpDir, { gates: { test: PASS }, defaultGates: ['test'], review: { tier: 1 } });
    await writePlan(tmpDir, twoTaskPhasePlan());

    await runAdvance({ cwd: tmpDir, task: '1.1', gate: true });
    await runReviewRecord({ cwd: tmpDir, phase: '1', verdict: 'fail', notes: 'edge case missing' });
    process.exitCode = 0;
    await runAdvance({ cwd: tmpDir, task: '1.2', gate: true });
    expect(process.exitCode).toBe(1);
  });

  it('tier 0 (default) does not require a review', async () => {
    await runInit({ codex: true, cwd: tmpDir });
    await setOrchestration(tmpDir, { gates: { test: PASS }, defaultGates: ['test'] }); // no review tier
    await writePlan(tmpDir, twoTaskPhasePlan());

    await runAdvance({ cwd: tmpDir, task: '1.1', gate: true });
    await runAdvance({ cwd: tmpDir, task: '1.2', gate: true });
    expect(process.exitCode).toBe(0);
    const loaded = await loadPlan(tmpDir);
    if (loaded.exists && loaded.valid) expect(loaded.plan.phases[0].status).toBe('done');
  });
});

describe('worktree signature in a nested project (project root below the git toplevel)', () => {
  async function nestedRepo(): Promise<{ repo: string; project: string }> {
    const repo = tmpDir;
    const project = path.join(repo, 'apps', 'my project');
    await fs.ensureDir(path.join(project, 'src'));
    await fs.writeFile(path.join(project, 'src', 'a.ts'), 'export const a = 1;\n');
    await fs.ensureDir(path.join(repo, 'other'));
    await fs.writeFile(path.join(repo, 'other', 'x.ts'), 'x\n');
    await execa('git', ['init', '-q'], { cwd: repo });
    await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
    await execa('git', ['config', 'user.name', 'Test User'], { cwd: repo });
    await execa('git', ['add', '.'], { cwd: repo });
    await execa('git', ['commit', '-q', '-m', 'init'], { cwd: repo });
    await runInit({ codex: true, cwd: project });
    await writePlan(project, twoTaskPhasePlan());
    return { repo, project };
  }

  it('a just-recorded review is pass, not stale', async () => {
    const { project } = await nestedRepo();
    await runReviewRecord({ cwd: project, phase: '1', verdict: 'pass' });
    const record = await readReviewRecord(project, '1');
    expect(reviewStatus(record, await worktreeSignature(project))).toBe('pass');
  });

  it('ignores dirty files outside the project but tracks source changes inside it', async () => {
    const { repo, project } = await nestedRepo();
    const before = await worktreeSignature(project);
    await fs.writeFile(path.join(repo, 'other', 'x.ts'), 'changed\n');
    await fs.writeFile(path.join(repo, 'other', 'new.ts'), 'new\n');
    expect(await worktreeSignature(project)).toBe(before);

    await fs.writeFile(path.join(project, 'src', 'a.ts'), 'export const a = 2;\n');
    const afterEdit = await worktreeSignature(project);
    expect(afterEdit).not.toBe(before);
    // Content of the in-project file is hashed (read from the right path).
    await fs.writeFile(path.join(project, 'src', 'a.ts'), 'export const a = 3;\n');
    expect(await worktreeSignature(project)).not.toBe(afterEdit);
  });
});

describe('parsePorcelainZ', () => {
  it('strips the prefix, keeps rename targets, handles spaces and an empty prefix', () => {
    const out = ['R  apps/p/new name.ts', 'apps/p/old.ts', '?? apps/p/.agent-flow/reviews/1.json', ' M other/x.ts', ''].join('\0');
    expect(parsePorcelainZ(out, 'apps/p/')).toEqual([
      { code: 'R ', path: 'new name.ts' },
      { code: '??', path: '.agent-flow/reviews/1.json' },
    ]);
    expect(parsePorcelainZ(' M src/a.ts\0', '')).toEqual([{ code: ' M', path: 'src/a.ts' }]);
  });
});

import path from 'node:path';
import os from 'node:os';
import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runContext } from '../src/commands/context.js';
import { runInit } from '../src/commands/init.js';
import { runNext } from '../src/commands/orchestrate.js';
import { budgetContextPack, buildContextPack, formatContextPack } from '../src/core/context-pack.js';
import { appendMemoryEntry } from '../src/core/jsonl-memory.js';
import { emptyPlan, writePlan } from '../src/core/plan.js';
import { buildTokenStats, estimateTokens, formatTokenStats } from '../src/core/token-stats.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-flow-budget-test-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.remove(tmpDir);
});

function logged(): string[] {
  return vi.mocked(console.log).mock.calls.map((call) => String(call[0]));
}

async function seedMemory(root: string): Promise<void> {
  await fs.ensureDir(path.join(root, '.planning'));
  await fs.writeFile(path.join(root, '.planning/STATE.md'), '# State\n\n## Current Status\n\nBilling webhook work is active.\n');
  await fs.writeFile(path.join(root, '.planning/PROJECT.md'), '# Project\n\n## Purpose\n\nBilling service.\n');
  for (let i = 0; i < 5; i += 1) {
    await appendMemoryEntry(root, 'modules', { type: 'module', module: `billing${i}`, summary: `Billing webhook module ${i} owns part of the flow.` });
    await appendMemoryEntry(root, 'events', { type: 'change', module: 'billing', summary: `Billing webhook change number ${i}.` });
    await appendMemoryEntry(root, 'errors', { type: 'error', module: 'billing', summary: `Billing webhook error ${i}.`, cause: 'cause', solution: 'solution' });
  }
}

describe('budgetContextPack', () => {
  it('selects the same items as the text renderer and reports what it omitted', async () => {
    await seedMemory(tmpDir);
    const pack = await buildContextPack('billing webhook', { cwd: tmpDir, limit: 5 });
    const budgetLines = 30;

    const budgeted = budgetContextPack(pack, budgetLines);
    const text = formatContextPack(pack, { budgetLines });

    const total = (p: typeof pack) => Object.values(p.items).reduce((n, xs) => n + xs.length, 0);
    expect(total(budgeted)).toBeLessThan(total(pack));
    expect(budgeted.budget.lines).toBe(budgetLines);
    expect(Object.values(budgeted.budget.omitted).reduce((a, b) => a + b, 0)).toBe(total(pack) - total(budgeted));
    // Every item kept in JSON appears in the text view.
    for (const item of Object.values(budgeted.items).flat()) {
      expect(text).toContain(item.summary);
    }
  });

  it('omits nothing when the budget is generous', async () => {
    await seedMemory(tmpDir);
    const pack = await buildContextPack('billing webhook', { cwd: tmpDir });
    const budgeted = budgetContextPack(pack, 10_000);
    expect(Object.values(budgeted.budget.omitted).every((n) => n === 0)).toBe(true);
  });
});

describe('context --json', () => {
  it('honors --budget-lines and measures the payload it emits', async () => {
    await seedMemory(tmpDir);

    await runContext('billing webhook', { cwd: tmpDir, json: true, budgetLines: 30 });
    const small = JSON.parse(logged()[0]);
    vi.mocked(console.log).mockClear();
    await runContext('billing webhook', { cwd: tmpDir, json: true, budgetLines: 500 });
    const large = JSON.parse(logged()[0]);

    const count = (p: { items: Record<string, unknown[]> }) => Object.values(p.items).reduce((n, xs) => n + xs.length, 0);
    expect(count(small)).toBeLessThan(count(large));
    expect(small.budget.lines).toBe(30);

    vi.mocked(console.log).mockClear();
    await runContext('billing webhook', { cwd: tmpDir, json: true, budgetLines: 30, stats: true });
    const withStats = JSON.parse(logged()[0]);
    const { stats, ...payload } = withStats;
    expect(stats.method).toBe('estimate:chars/4');
    expect(stats.packTokens).toBe(estimateTokens(JSON.stringify(payload, null, 2)));
  });
});

describe('next --json', () => {
  it('applies --budget-lines to the envelope context pack', async () => {
    await runInit({ codex: true, cwd: tmpDir });
    await seedMemory(tmpDir);
    await writePlan(tmpDir, {
      ...emptyPlan(new Date('2026-01-01T00:00:00.000Z')),
      phases: [{
        id: '1', title: 'Billing webhook', goal: '', requirements: [], dependsOn: [], status: 'pending',
        tasks: [{ id: '1.1', title: 'billing webhook idempotency', scope: ['src/a.ts'], wave: 1, dependsOn: [], status: 'pending', gates: [], acceptance: [] }],
      }],
    });

    vi.mocked(console.log).mockClear();
    await runNext({ cwd: tmpDir, json: true, peek: true, budgetLines: 20 });
    const envelope = JSON.parse(logged()[0]);
    expect(envelope.contextPack.budget.lines).toBe(20);
    expect(Object.values(envelope.contextPack.budget.omitted as Record<string, number>).some((n) => n > 0)).toBe(true);
    // Machine-consumed envelope is compact JSON.
    expect(logged()[0]).not.toContain('\n  ');
  });
});

describe('token stats', () => {
  it('reports expansion as a negative saving instead of clamping to zero', async () => {
    await fs.ensureDir(path.join(tmpDir, '.planning'));
    await fs.writeFile(path.join(tmpDir, '.planning/STATE.md'), 'x'.repeat(40));
    const stats = await buildTokenStats(tmpDir, 'y'.repeat(400));
    expect(stats?.savedTokens).toBe(10 - 100);
    expect(stats?.reductionPercent).toBe(-900);
    expect(formatTokenStats(stats!)).toContain('EXPANSION: 90 tokens');
  });
});

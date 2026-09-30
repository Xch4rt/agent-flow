import path from 'node:path';
import os from 'node:os';
import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { finishBenchRun, formatBenchMarkdown, loadBenchResults, loadBenchSpec, median, prepareBenchRun, summarizeBench } from '../src/core/bench.js';
import { projectSlug } from '../src/core/claude-usage.js';
import { runBenchReport } from '../src/commands/bench.js';

const TASK = path.join(__dirname, '..', 'bench', 'tasks', 'slugify');
const REFERENCE = path.join(__dirname, 'fixtures', 'slugify-reference.js');
let tmpDir: string;
let benchDir: string;
let claudeDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-flow-bench-test-'));
  benchDir = path.join(tmpDir, 'runs');
  claudeDir = path.join(tmpDir, 'claude');
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.remove(tmpDir);
});

async function fakeSession(workspace: string, context: number, subagentContext = 0): Promise<void> {
  const dir = path.join(claudeDir, 'projects', projectSlug(workspace));
  const at = new Date(Date.now() + 1000).toISOString();
  const row = (id: string, ctx: number, extra: Record<string, unknown> = {}) => JSON.stringify({
    type: 'assistant', sessionId: 's1', cwd: workspace, timestamp: at, requestId: id,
    message: { id, model: 'claude-test', usage: { input_tokens: 10, cache_creation_input_tokens: 1000, cache_read_input_tokens: ctx, output_tokens: 100 } },
    ...extra,
  });
  await fs.outputFile(path.join(dir, 's1.jsonl'), `${row('r1', context)}\n${row('r2', context)}\n`);
  if (subagentContext) await fs.outputFile(path.join(dir, 's1', 'subagents', 'agent-a1.jsonl'), `${row('s1', subagentContext)}\n`);
}

describe('bench', () => {
  it('loads the example task', async () => {
    const spec = await loadBenchSpec(TASK);
    expect(spec).toMatchObject({ name: 'slugify', check: 'node --test' });
    await expect(loadBenchSpec(tmpDir)).rejects.toThrow(/missing bench.json/);
  });

  it('prepare → agent works → finish records hidden-test result and isolated usage', async () => {
    const run = await prepareBenchRun(TASK, 'af-next', { benchDir });
    expect(run.workspace).toContain(path.join('slugify', 'af-next-'));
    // The agent never sees hidden tests in the workspace.
    expect(await fs.pathExists(path.join(run.workspace, 'test', 'acceptance.hidden.test.js'))).toBe(false);
    expect(await fs.pathExists(path.join(run.workspace, '.git'))).toBe(true);

    await fs.copy(REFERENCE, path.join(run.workspace, 'src', 'slugify.js'));
    await fakeSession(run.workspace, 40_000, 20_000);

    const result = await finishBenchRun(path.dirname(run.workspace), { claudeDir });
    expect(result.passed).toBe(true);
    expect(result.check.summary).toBe('9 passed, 0 failed');
    expect(result.usage.sessions).toBe(1);
    expect(result.usage.totals.calls).toBe(3);
    expect(result.usage.subagents.calls).toBe(1);
    expect(result.usage.peakContext).toBe(41_010);
    expect(await fs.pathExists(path.join(path.dirname(run.workspace), 'result.json'))).toBe(true);
  });

  it('a variant that does not implement the task fails the hidden tests', async () => {
    const run = await prepareBenchRun(TASK, 'plain', { benchDir });
    const result = await finishBenchRun(path.dirname(run.workspace), { claudeDir });
    expect(result.passed).toBe(false);
    expect(result.check.failures).toBeGreaterThan(0);
    expect(result.usage.sessions).toBe(0);
  }, 20_000);

  it('report: medians per task × variant with a vs-best column', async () => {
    const a = await prepareBenchRun(TASK, 'af-next', { benchDir });
    await fs.copy(REFERENCE, path.join(a.workspace, 'src', 'slugify.js'));
    await fakeSession(a.workspace, 20_000);
    await finishBenchRun(path.dirname(a.workspace), { claudeDir });

    const b = await prepareBenchRun(TASK, 'gsd', { benchDir, now: new Date(Date.now() + 5000) });
    await fs.copy(REFERENCE, path.join(b.workspace, 'src', 'slugify.js'));
    await fakeSession(b.workspace, 80_000, 60_000);
    await finishBenchRun(path.dirname(b.workspace), { claudeDir });

    const rows = summarizeBench(await loadBenchResults(benchDir));
    expect(rows.map((r) => r.variant)).toEqual(['af-next', 'gsd']);
    const md = formatBenchMarkdown(rows);
    expect(md).toContain('| slugify | af-next | 1 | 100% |');
    expect(md).toMatch(/\| slugify \| af-next \| .* \| 100% \| .*/);
    expect(md).toMatch(/\| slugify \| gsd \| 1 \| 100% \| [\d.]+k \| \d{3,}% \|/);

    const out = path.join(tmpDir, 'BENCH.md');
    await runBenchReport({ dir: benchDir, out });
    expect(await fs.readFile(out, 'utf8')).toContain('| Task | Variant |');
  }, 30_000);

  it('rejects unsafe variant names and duplicate runs', async () => {
    await expect(prepareBenchRun(TASK, '../x', { benchDir })).rejects.toThrow(/--variant/);
    const now = new Date('2026-01-01T00:00:00Z');
    await prepareBenchRun(TASK, 'v', { benchDir, now });
    await expect(prepareBenchRun(TASK, 'v', { benchDir, now })).rejects.toThrow(/already exists/);
  });

  it('median', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});

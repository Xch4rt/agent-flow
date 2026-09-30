import path from 'node:path';
import os from 'node:os';
import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compactOutput, formatCompact, stripAnsi } from '../src/core/compact-output.js';
import { runCompact } from '../src/core/run-compact.js';
import { runRunCommand } from '../src/commands/run.js';
import { runGate } from '../src/core/gates.js';

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', 'output', name), 'utf8');

describe('compactOutput parsers', () => {
  it('vitest: each failing test with location and reason', () => {
    const out = compactOutput(fixture('vitest.txt'));
    expect(out.tool).toBe('vitest');
    expect(out.summary).toBe('Tests  2 failed | 1 passed (3)');
    expect(out.failures).toEqual([
      'a.test.ts > math > adds (a.test.ts:3:36) — AssertionError: expected 2 to be 3 // Object.is equality',
      'a.test.ts > math > throws (a.test.ts:5:30) — Error: boom here',
    ]);
  });

  it('jest', () => {
    const out = compactOutput(fixture('jest.txt'));
    expect(out.tool).toBe('jest');
    expect(out.failures[0]).toBe('math › adds (src/math.test.js:2:17) — expect(received).toBe(expected) // Object.is equality');
    expect(out.failures[1]).toContain('math › parses (src/parse.js:10:5) — TypeError');
    expect(out.summary).toContain('2 failed');
  });

  it('tsc plain and pretty', () => {
    expect(compactOutput(fixture('tsc.txt')).failures).toEqual(["bad.ts:1:7 TS2322 — Type 'string' is not assignable to type 'number'."]);
    const pretty = compactOutput(fixture('tsc-pretty.txt'));
    expect(pretty.tool).toBe('tsc');
    expect(pretty.failures).toEqual(["src/a.ts:3:7 TS2322 — Type 'string' is not assignable to type 'number'."]);
  });

  it('eslint keeps errors, drops warnings', () => {
    const out = compactOutput(fixture('eslint.txt'));
    expect(out.tool).toBe('eslint');
    expect(out.failures).toHaveLength(2);
    expect(out.failures[0]).toBe("/Users/me/app/src/a.ts:3:7 @typescript-eslint/no-unused-vars — 'x' is assigned a value but never used");
  });

  it('pytest', () => {
    const out = compactOutput(fixture('pytest.txt'));
    expect(out.tool).toBe('pytest');
    expect(out.failures).toEqual(['tests/test_math.py::test_add — assert 2 == 3']);
    expect(out.summary).toBe('1 failed, 2 passed in 0.12s');
  });

  it('falls back to the tail for unknown tools', () => {
    const out = compactOutput(Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n'));
    expect(out.tool).toBe('generic');
    expect(out.tail).toHaveLength(12);
    expect(formatCompact(out)).toContain('line 49');
  });

  it('strips ANSI and caps the failure list', () => {
    expect(stripAnsi('\u001b[31mred\u001b[39m')).toBe('red');
    const many = Array.from({ length: 30 }, (_, i) => `src/f${i}.ts(1,1): error TS1000: bad`).join('\n');
    const text = formatCompact(compactOutput(many), { maxFailures: 5 });
    expect(text).toContain('… 25 more');
  });

  it('is much smaller than the raw output', () => {
    const raw = fixture('vitest.txt');
    expect(formatCompact(compactOutput(raw)).length).toBeLessThan(raw.length / 3);
  });
});

describe('agent-flow run', () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-flow-run-test-'));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    process.exitCode = 0;
    await fs.remove(tmpDir);
  });

  it('prints one line on success and keeps the full log', async () => {
    const run = await runCompact(tmpDir, 'node -e "console.log(1);console.log(2)"');
    expect(run.exitCode).toBe(0);
    expect(run.text).toMatch(/^ok · [\d.]+s · 2$/);
    expect(await fs.readFile(path.join(tmpDir, run.logPath), 'utf8')).toContain('1\n2');
  });

  it('prints failures and the log path on error, and propagates the exit code', async () => {
    const script = path.join(tmpDir, 'fail.js');
    await fs.writeFile(script, `console.log(${JSON.stringify(fixture('tsc.txt'))}); process.exit(2);`);
    await runRunCommand(['node', script], { cwd: tmpDir });
    const out = vi.mocked(console.log).mock.calls.map((c) => String(c[0])).join('\n');
    expect(out).toContain('exit 2');
    expect(out).toContain('bad.ts:1:7 TS2322');
    expect(out).toMatch(/full log: \.agent-flow[\\/]logs[\\/].+\.log/);
    expect(process.exitCode).toBe(2);
  });

  it('gates report compact failures instead of a raw tail', async () => {
    const script = path.join(tmpDir, 'fail.js');
    await fs.writeFile(script, `console.log(${JSON.stringify(fixture('vitest.txt'))}); process.exit(1);`);
    const result = await runGate(tmpDir, 'test', { test: `node ${script}` });
    expect(result.ok).toBe(false);
    expect(result.outputTail).toContain('✗ a.test.ts > math > adds (a.test.ts:3:36)');
    expect(result.outputTail).toContain('full log: ');
    expect(result.outputTail).not.toContain('Object.is equality\n\n');
  });
});

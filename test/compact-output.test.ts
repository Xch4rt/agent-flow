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

  it('node:test, TAP and spec reporters', () => {
    const tap = compactOutput(fixture('node-test-tap.txt'));
    expect(tap).toMatchObject({ tool: 'node-test', summary: '1 passed, 1 failed' });
    expect(tap.failures[0]).toMatch(/^adds \(.*a\.test\.mjs:2:1\) — Expected values to be strictly equal: 2 !== 3$/);
    const spec = compactOutput(fixture('node-test-spec.txt'));
    expect(spec.failures[0]).toMatch(/^adds \(a\.test\.mjs:2:1\) — AssertionError \[ERR_ASSERTION\]: Expected values to be strictly equal: 2 !== 3$/);
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

describe('compactOutput: go, cargo, ruff, rustc', () => {
  it('go test -v: failing test with file:line, package summary', () => {
    const out = compactOutput(
      [
        '=== RUN   TestAdd',
        '--- PASS: TestAdd (0.00s)',
        '=== RUN   TestSub',
        '    math_test.go:12: expected 1, got 2',
        '--- FAIL: TestSub (0.00s)',
        'FAIL',
        'FAIL\texample.com/m\t0.003s',
        'ok  \texample.com/other\t0.002s',
        'FAIL',
      ].join('\n'),
    );
    expect(out.tool).toBe('go-test');
    expect(out.failures).toEqual(['TestSub (math_test.go:12) — expected 1, got 2']);
    expect(out.summary).toBe('1 package(s) passed, 1 failed');
  });

  it('go test plain with subtests reports the leaf only', () => {
    const out = compactOutput(
      ['--- FAIL: TestP (0.00s)', '    --- FAIL: TestP/sub (0.00s)', '        p_test.go:7: bad value', 'FAIL', 'FAIL\texample.com/m\t0.01s'].join('\n'),
    );
    expect(out.failures).toEqual(['TestP/sub (p_test.go:7) — bad value']);
  });

  it('cargo test: panic location and message', () => {
    const out = compactOutput(
      [
        'running 2 tests',
        'test tests::ok_one ... ok',
        'test tests::bad ... FAILED',
        '',
        'failures:',
        '',
        '---- tests::bad stdout ----',
        "thread 'tests::bad' panicked at src/lib.rs:10:5:",
        'assertion `left == right` failed',
        '  left: 1',
        ' right: 2',
        'note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace',
        '',
        'failures:',
        '    tests::bad',
        '',
        'test result: FAILED. 1 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s',
      ].join('\n'),
    );
    expect(out.tool).toBe('cargo-test');
    expect(out.failures).toEqual(['tests::bad (src/lib.rs:10:5) — assertion `left == right` failed']);
    expect(out.summary).toContain('1 passed; 1 failed');
  });

  it('ruff check: one failure per line', () => {
    const out = compactOutput(
      ['src/a.py:1:8: F401 [*] `os` imported but unused', 'src/b.py:10:1: E501 Line too long (120 > 88)', 'Found 2 errors.', '[*] 1 fixable with the `--fix` option.'].join('\n'),
    );
    expect(out.tool).toBe('ruff');
    expect(out.failures).toEqual(['src/a.py:1 F401 — `os` imported but unused', 'src/b.py:10 E501 — Line too long (120 > 88)']);
    expect(out.summary).toBe('Found 2 errors.');
  });

  it('clippy/rustc: errors listed, warnings only counted', () => {
    const out = compactOutput(
      [
        'warning: unused variable: `x`',
        ' --> src/main.rs:2:9',
        '  |',
        '2 |     let x = 1;',
        '',
        'error[E0308]: mismatched types',
        ' --> src/main.rs:3:5',
        '  |',
        '3 |     "a"',
        '',
        'error: aborting due to 1 previous error; 1 warning emitted',
      ].join('\n'),
    );
    expect(out.tool).toBe('rustc');
    expect(out.failures).toEqual(['src/main.rs:3:5 E0308 — mismatched types']);
    expect(out.summary).toBe('1 error(s), 1 warning(s)');
  });

  it('existing tools keep winning and unrelated output stays generic', () => {
    expect(compactOutput(fixture('pytest.txt')).tool).toBe('pytest');
    expect(compactOutput(fixture('tsc.txt')).tool).toBe('tsc');
    expect(compactOutput('hello\nworld\n').tool).toBe('generic');
  });
});

/**
 * Compact tool output for agents: keep the failures, drop the noise.
 *
 * Test runners, compilers and linters print far more than an agent needs to
 * act on — and every line an agent reads is re-read on every later turn. These
 * deterministic parsers extract just the failures (what, where, why); callers
 * keep the full log on disk for the rare case it is needed.
 */

export type ToolKind = 'vitest' | 'jest' | 'tsc' | 'eslint' | 'pytest' | 'node-test' | 'generic';

export type CompactOutput = {
  tool: ToolKind;
  /** One entry per failure: "<where> — <why>" style, already trimmed. */
  failures: string[];
  /** Tool's own one-line summary when it prints one (e.g. "Tests 2 failed | 1 passed (3)"). */
  summary?: string;
  /** Last lines of output, used when no parser matched. */
  tail: string[];
};

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

function clip(value: string, max = 200): string {
  const v = value.replace(/\s+/g, ' ').trim();
  return v.length > max ? `${v.slice(0, max - 1)}…` : v;
}

function parseVitest(lines: string[]): Omit<CompactOutput, 'tail'> | null {
  if (!lines.some((l) => /\bFAIL\b|Test Files|✓|×/.test(l)) || !lines.some((l) => /^\s*(Test Files|Tests)\s+\d/.test(l) || /vitest/i.test(l))) return null;
  const failures: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^\s*FAIL\s+(.+)$/.exec(lines[i]);
    if (!m) continue;
    const name = m[1].trim();
    let why = '';
    let where = '';
    for (let j = i + 1; j < Math.min(lines.length, i + 40); j += 1) {
      const line = lines[j];
      if (/^\s*FAIL\s+/.test(line) || /⎯{5,}/.test(line)) break;
      if (!why && line.trim() && !/^\s*[-+]\s/.test(line) && !/^\s*(Expected|Received)/.test(line)) why = line.trim();
      const loc = /❯\s+(\S+:\d+:\d+)/.exec(line);
      if (loc && !where) where = loc[1];
    }
    failures.push(clip(`${name}${where ? ` (${where})` : ''} — ${why || 'failed'}`));
  }
  const summary = lines.find((l) => /^\s*Tests\s+\d/.test(l))?.trim();
  if (failures.length === 0 && !summary) return null;
  return { tool: 'vitest', failures, summary };
}

function parseJest(lines: string[]): Omit<CompactOutput, 'tail'> | null {
  if (!lines.some((l) => /^\s*●\s/.test(l)) && !lines.some((l) => /^Tests:\s+\d/.test(l))) return null;
  const failures: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^\s*●\s+(.+)$/.exec(lines[i]);
    if (!m) continue;
    let why = '';
    let where = '';
    for (let j = i + 1; j < Math.min(lines.length, i + 40); j += 1) {
      const line = lines[j];
      if (/^\s*●\s/.test(line) || /^Test Suites:/.test(line)) break;
      if (!why && line.trim() && !/^\s*(>|\d+\s*\|)/.test(line)) why = line.trim();
      const loc = /\(([^()]+:\d+:\d+)\)/.exec(line);
      if (loc && !where) where = loc[1];
    }
    failures.push(clip(`${m[1].trim()}${where ? ` (${where})` : ''} — ${why || 'failed'}`));
  }
  const summary = lines.find((l) => /^Tests:\s+\d/.test(l))?.trim();
  return { tool: 'jest', failures, summary };
}

function parseTsc(lines: string[]): Omit<CompactOutput, 'tail'> | null {
  const failures: string[] = [];
  for (const line of lines) {
    const plain = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.*)$/.exec(line);
    const pretty = /^(.+?):(\d+):(\d+)\s+-\s+error\s+(TS\d+):\s+(.*)$/.exec(line);
    const m = plain ?? pretty;
    if (m) failures.push(clip(`${m[1]}:${m[2]}:${m[3]} ${m[4]} — ${m[5]}`));
  }
  if (failures.length === 0) return null;
  const summary = lines.find((l) => /^Found \d+ errors?/.test(l))?.trim() ?? `${failures.length} error(s)`;
  return { tool: 'tsc', failures, summary };
}

function parseEslint(lines: string[]): Omit<CompactOutput, 'tail'> | null {
  if (!lines.some((l) => /^✖ \d+ problems?/.test(l.trim()))) return null;
  const failures: string[] = [];
  let file = '';
  for (const line of lines) {
    if (/^\S/.test(line) && !/^✖/.test(line)) {
      file = line.trim();
      continue;
    }
    const m = /^\s+(\d+):(\d+)\s+(error|warning)\s+(.+?)\s{2,}(\S+)\s*$/.exec(line);
    if (m && m[3] === 'error') failures.push(clip(`${file}:${m[1]}:${m[2]} ${m[5]} — ${m[4]}`));
  }
  const summary = lines.find((l) => /^✖ \d+ problems?/.test(l.trim()))?.trim();
  return { tool: 'eslint', failures, summary };
}

function parsePytest(lines: string[]): Omit<CompactOutput, 'tail'> | null {
  if (!lines.some((l) => /short test summary info|^=+ .*(passed|failed|error).* in [\d.]+s/.test(l))) return null;
  const failures: string[] = [];
  for (const line of lines) {
    const m = /^(FAILED|ERROR)\s+(\S+)(?:\s+-\s+(.*))?$/.exec(line.trim());
    if (m) failures.push(clip(`${m[2]} — ${m[3] ?? m[1].toLowerCase()}`));
  }
  const summary = [...lines].reverse().find((l) => /^=+ .* in [\d.]+s/.test(l))?.replace(/=+/g, '').trim();
  return { tool: 'pytest', failures, summary };
}

/** First non-empty line from `from`; when it ends with ':' also append the next one ("…equal: 2 !== 3"). */
function withDetail(lines: string[], from: number): string {
  const rest = lines.slice(from, from + 8).map((l) => l.trim()).filter(Boolean);
  if (rest.length === 0) return '';
  return rest[0].endsWith(':') && rest[1] && !rest[1].startsWith('at ') ? `${rest[0]} ${rest[1]}` : rest[0];
}

function parseNodeTest(lines: string[]): Omit<CompactOutput, 'tail'> | null {
  const tap = lines.some((l) => /^# (pass|fail) \d+/.test(l));
  const spec = lines.some((l) => /^ℹ (pass|fail) \d+/.test(l));
  if (!tap && !spec) return null;
  const failures: string[] = [];
  if (tap) {
    for (let i = 0; i < lines.length; i += 1) {
      const m = /^\s*not ok \d+ - (.+)$/.exec(lines[i]);
      if (!m) continue;
      let where = '';
      let why = '';
      for (let j = i + 1; j < Math.min(lines.length, i + 30); j += 1) {
        const line = lines[j];
        if (/^\s*\.\.\.\s*$/.test(line)) break;
        const loc = /location:\s*'(.+)'/.exec(line);
        if (loc) where = loc[1];
        if (/^\s*error:/.test(line)) {
          const inline = line.replace(/^\s*error:\s*(\|-?)?/, '').trim();
          why = inline || withDetail(lines, j + 1);
        }
      }
      failures.push(clip(`${m[1].trim()}${where ? ` (${where})` : ''} — ${why || 'failed'}`));
    }
  } else {
    const start = lines.findIndex((l) => /^✖ failing tests:/.test(l.trim()));
    for (let i = Math.max(0, start); start >= 0 && i < lines.length; i += 1) {
      const at = /^test at (.+)$/.exec(lines[i].trim());
      if (!at) continue;
      const name = (/^✖ (.+?)(?: \([\d.]+m?s\))?$/.exec(lines[i + 1]?.trim() ?? '') ?? [])[1] ?? 'test';
      const why = withDetail(lines, i + 2);
      failures.push(clip(`${name} (${at[1]}) — ${why || 'failed'}`));
    }
  }
  const pick = (key: string) => lines.map((l) => new RegExp(`^(?:#|ℹ) ${key} (\\d+)`).exec(l)).find(Boolean)?.[1];
  const summary = `${pick('pass') ?? '?'} passed, ${pick('fail') ?? '?'} failed`;
  return { tool: 'node-test', failures, summary };
}

const PARSERS: Array<(lines: string[]) => Omit<CompactOutput, 'tail'> | null> = [parseNodeTest, parsePytest, parseJest, parseVitest, parseEslint, parseTsc];

export function compactOutput(raw: string, options: { tailLines?: number } = {}): CompactOutput {
  const text = stripAnsi(raw);
  const lines = text.split(/\r?\n/);
  const tail = text.trim() ? text.trim().split(/\r?\n/).slice(-(options.tailLines ?? 12)) : [];
  for (const parse of PARSERS) {
    const result = parse(lines);
    if (result) return { ...result, tail };
  }
  return { tool: 'generic', failures: [], tail };
}

/** Render for an agent: summary + failures (capped); falls back to the tail. */
export function formatCompact(out: CompactOutput, options: { maxFailures?: number } = {}): string {
  const max = options.maxFailures ?? 20;
  if (out.failures.length === 0) {
    return [out.summary ? `${out.tool}: ${out.summary}` : '', ...out.tail].filter(Boolean).join('\n');
  }
  const shown = out.failures.slice(0, max).map((f) => `  ✗ ${f}`);
  const more = out.failures.length > max ? [`  … ${out.failures.length - max} more`] : [];
  return [`${out.tool}: ${out.summary ?? `${out.failures.length} failure(s)`}`, ...shown, ...more].join('\n');
}

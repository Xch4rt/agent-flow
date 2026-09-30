import path from 'node:path';
import os from 'node:os';
import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildUsageReport,
  findTranscriptFiles,
  inputEquivalent,
  parseSince,
  projectSlug,
} from '../src/core/claude-usage.js';
import { formatUsageReport, runUsage } from '../src/commands/usage.js';

let tmpDir: string;
const SESSION = '11111111-aaaa-bbbb-cccc-000000000001';
const PROJECT = '/Users/pablo/work/agent-flow';

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-flow-usage-test-'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.remove(tmpDir);
});

type Usage = { input?: number; write?: number; read?: number; output?: number };

function assistant(requestId: string, at: string, u: Usage, extra: Record<string, unknown> = {}, content: unknown[] = [{ type: 'text', text: 'ok' }]) {
  return {
    type: 'assistant',
    sessionId: SESSION,
    cwd: PROJECT,
    timestamp: at,
    requestId,
    isSidechain: false,
    message: {
      id: `msg_${requestId}`,
      model: 'claude-opus-test',
      content,
      usage: {
        input_tokens: u.input ?? 0,
        cache_creation_input_tokens: u.write ?? 0,
        cache_read_input_tokens: u.read ?? 0,
        output_tokens: u.output ?? 0,
      },
    },
    ...extra,
  };
}

function user(at: string, text: string) {
  return { type: 'user', sessionId: SESSION, cwd: PROJECT, timestamp: at, isSidechain: false, message: { role: 'user', content: text } };
}

function toolResult(at: string) {
  return { type: 'user', sessionId: SESSION, timestamp: at, isSidechain: false, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'done' }] } };
}

async function writeTranscript(rows: unknown[], file = path.join(tmpDir, 'projects', projectSlug(PROJECT), `${SESSION}.jsonl`)): Promise<string> {
  await fs.ensureDir(path.dirname(file));
  await fs.writeFile(file, `${rows.map((r) => JSON.stringify(r)).join('\n')}\nnot json\n`);
  return file;
}

describe('projectSlug', () => {
  it('replaces every non-alphanumeric char with a dash, like Claude Code', () => {
    expect(projectSlug('/Users/pablo/xch4rt/work/my.self/agent-flow')).toBe('-Users-pablo-xch4rt-work-my-self-agent-flow');
  });
});

describe('parseSince', () => {
  it('parses relative and absolute values', () => {
    const now = Date.parse('2026-09-30T12:00:00Z');
    expect(parseSince('7d', now)?.toISOString()).toBe('2026-09-23T12:00:00.000Z');
    expect(parseSince('90m', now)?.toISOString()).toBe('2026-09-30T10:30:00.000Z');
    expect(parseSince('2026-09-01')?.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(parseSince(undefined)).toBeUndefined();
    expect(() => parseSince('yesterday')).toThrow(/--since/);
  });
});

describe('buildUsageReport', () => {
  it('deduplicates per-block rows, splits main/subagents, attributes skills and classifies cache breaks', async () => {
    const file = await writeTranscript([
      user('2026-09-30T10:00:00Z', '<command-name>/flow-orchestrate</command-name>'),
      // First request: large write (session start). Same requestId appears twice (two content blocks).
      assistant('r1', '2026-09-30T10:00:05Z', { input: 10, write: 30_000, read: 0, output: 50 }),
      assistant('r1', '2026-09-30T10:00:06Z', { input: 10, write: 30_000, read: 0, output: 400 }),
      toolResult('2026-09-30T10:00:10Z'),
      assistant('r2', '2026-09-30T10:01:00Z', { input: 5, write: 2_000, read: 30_000, output: 100 }),
      // Subagent turn inline in the session file.
      assistant('s1', '2026-09-30T10:01:30Z', { input: 3, write: 25_000, read: 0, output: 200 }, { isSidechain: true, agentId: 'a1' }),
      // 20 minutes idle, then the whole context is re-written.
      user('2026-09-30T10:21:00Z', 'continue please'),
      assistant('r3', '2026-09-30T10:21:05Z', { input: 5, write: 250_000, read: 0, output: 100 }),
      // Short gap but large write: prefix changed (e.g. compaction / model switch).
      assistant('r4', '2026-09-30T10:22:00Z', { input: 5, write: 40_000, read: 200_000, output: 100 }),
      // Skill tool invocation switches attribution.
      assistant('r5', '2026-09-30T10:23:00Z', { input: 1, write: 100, read: 240_000, output: 10 }, {}, [{ type: 'tool_use', id: 't2', name: 'Skill', input: { skill: 'flow-close' } }]),
      assistant('r6', '2026-09-30T10:23:30Z', { input: 1, write: 100, read: 240_000, output: 10 }),
      // Synthetic rows (local errors) are not API calls.
      { ...assistant('x', '2026-09-30T10:24:00Z', { input: 999_999 }), message: { model: '<synthetic>', usage: { input_tokens: 999_999 } } },
    ]);

    const report = await buildUsageReport([file], tmpDir, { idleMinutes: 5 });

    expect(report.sessions).toHaveLength(1);
    const s = report.sessions[0];
    expect(s.totals.calls).toBe(7);
    expect(s.main.calls).toBe(6);
    expect(s.subagents.calls).toBe(1);
    expect(s.totals.output).toBe(400 + 100 + 200 + 100 + 100 + 10 + 10);
    expect(s.peakContext).toBe(250_000 + 5);
    expect(s.cwd).toBe(PROJECT);

    const reasons = s.cacheBreaks.map((b) => `${b.reason}:${b.cacheWrite}`).sort();
    expect(reasons).toEqual(['first-request:25000', 'first-request:30000', 'idle:250000', 'prefix-change:40000'].sort());
    const idle = s.cacheBreaks.find((b) => b.reason === 'idle');
    expect(idle?.gapMinutes).toBe(20.1);

    expect(report.bySkill['flow-orchestrate'].calls).toBe(2);
    expect(report.bySkill['(no skill)'].calls).toBe(2);
    expect(report.bySkill['flow-close'].calls).toBe(2);
    expect(report.bySkill['(subagent)'].calls).toBe(1);
    expect(report.byModel['claude-opus-test'].calls).toBe(7);
    expect(inputEquivalent(report.totals)).toBeGreaterThan(0);

    const text = formatUsageReport(report);
    expect(text).toContain('agent-flow usage');
    expect(text).toContain('flow-orchestrate');
    expect(text).toContain('cold-cache rewrites 1');
    expect(text).toContain('Signals');
  });

  it('merges subagent transcripts stored in their own folder into the parent session', async () => {
    const main = await writeTranscript([
      user('2026-09-30T10:00:00Z', 'hi'),
      assistant('r1', '2026-09-30T10:00:05Z', { input: 10, write: 1_000, output: 10 }),
    ]);
    const sub = await writeTranscript(
      [assistant('s1', '2026-09-30T10:00:30Z', { input: 10, write: 50_000, output: 10 }, { isSidechain: false })],
      path.join(path.dirname(main), SESSION, 'subagents', 'agent-abc.jsonl'),
    );

    const { files } = await findTranscriptFiles({ projectPath: PROJECT, dir: tmpDir });
    expect(files.sort()).toEqual([main, sub].sort());

    const report = await buildUsageReport(files, tmpDir);
    expect(report.sessions).toHaveLength(1);
    expect(report.sessions[0].subagents.calls).toBe(1);
    expect(report.sessions[0].main.calls).toBe(1);
    expect(report.sessions[0].file).toBe(main);
  });

  it('respects --since at the request level', async () => {
    const file = await writeTranscript([
      assistant('old', '2026-09-01T10:00:00Z', { input: 100 }),
      assistant('new', '2026-09-30T10:00:00Z', { input: 1 }),
    ]);
    const report = await buildUsageReport([file], tmpDir, { since: new Date('2026-09-15T00:00:00Z') });
    expect(report.totals.calls).toBe(1);
    expect(report.totals.input).toBe(1);
  });
});

describe('runUsage', () => {
  it('reports when no transcripts exist', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await runUsage({ cwd: PROJECT, dir: tmpDir });
    expect(log.mock.calls.flat().join('\n')).toContain('no Claude Code transcripts found');
  });

  it('prints JSON for the current project', async () => {
    await writeTranscript([assistant('r1', '2026-09-30T10:00:00Z', { input: 7, output: 3 })]);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await runUsage({ cwd: PROJECT, dir: tmpDir, json: true });
    const parsed = JSON.parse(String(log.mock.calls[0][0]));
    expect(parsed.totals).toMatchObject({ calls: 1, input: 7, output: 3 });
  });
});

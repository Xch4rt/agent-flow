import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCodexUsageReport, findCodexRolloutFiles, parseCodexRollout } from '../src/core/codex-usage.js';
import { canReadCompressedRollouts, findRolloutByThreadId, listRolloutFiles, readSessionMeta } from '../src/core/codex-sessions.js';
import { inputEquivalent } from '../src/core/claude-usage.js';
import { formatUsageReport, runUsage } from '../src/commands/usage.js';
import { collectTokenChecks } from '../src/commands/doctor-tokens.js';

let home: string;
let project: string;
const ROOT = '01a14d8a-1851-7490-89d0-f402bcc9a249';
const CHILD = '01a14d8a-2222-7490-89d0-f402bcc9a2ff';
const OTHER = '01a14d8a-3333-7490-89d0-f402bcc9a3ff';

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-flow-codex-home-'));
  project = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-flow-codex-project-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.remove(home);
  await fs.remove(project);
});

function logged(): string {
  return vi.mocked(console.log).mock.calls.map((call) => String(call[0])).join('\n');
}

type U = { input: number; cached?: number; output?: number };

function meta(id: string, cwd: string, extra: Record<string, unknown> = {}) {
  return { timestamp: '2026-10-18T05:44:42.358Z', ordinal: 0, type: 'session_meta', payload: { session_id: id, id, cwd, originator: 'Codex Desktop', cli_version: '0.162.0', source: 'vscode', thread_source: 'user', model_provider: 'openai', parent_thread_id: null, agent_role: null, ...extra } };
}
function turnContext(turn: string, model: string, at: string) {
  return { timestamp: at, type: 'turn_context', payload: { turn_id: turn, model, effort: 'medium', cwd: '/x' } };
}
function usageRecord(thread: string, session: string, turn: string, response: string, u: U, at: string) {
  return { timestamp: at, type: 'token_usage_record', payload: { thread_id: thread, session_id: session, turn_id: turn, response_id: response, usage: { input_tokens: u.input, cached_input_tokens: u.cached ?? 0, cache_write_input_tokens: 0, output_tokens: u.output ?? 0, reasoning_output_tokens: 0, total_tokens: u.input + (u.output ?? 0) } } };
}
function tokenCount(u: U, at: string) {
  return { timestamp: at, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: {}, last_token_usage: { input_tokens: u.input, cached_input_tokens: u.cached ?? 0, cache_write_input_tokens: 0, output_tokens: u.output ?? 0 }, model_context_window: 475000 } } };
}
function userMessage(text: string, at: string) {
  return { timestamp: at, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } };
}
function functionCall(name: string, args: Record<string, unknown>, at: string, callId = 'c1') {
  return { timestamp: at, type: 'response_item', payload: { type: 'function_call', name, arguments: JSON.stringify(args), call_id: callId } };
}
function functionOutput(callId: string, output: string, at: string) {
  return { timestamp: at, type: 'response_item', payload: { type: 'function_call_output', call_id: callId, output } };
}

async function rollout(day: string, stamp: string, id: string, rows: unknown[], ext = '.jsonl'): Promise<string> {
  const file = path.join(home, 'sessions', '2026', '10', day, `rollout-2026-10-${day}T${stamp}-${id}${ext}`);
  const text = `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`;
  await fs.ensureDir(path.dirname(file));
  if (ext.endsWith('.zst')) {
    const compress = (zlib as typeof zlib & { zstdCompressSync?: (b: Buffer) => Buffer }).zstdCompressSync;
    if (!compress) return file;
    await fs.writeFile(file, compress(Buffer.from(text)));
  } else {
    await fs.writeFile(file, text);
  }
  return file;
}

async function seedProject(): Promise<{ root: string; child: string }> {
  const root = await rollout('18', '05-44-18', ROOT, [
    meta(ROOT, project),
    userMessage('<environment_context>ignored</environment_context>', '2026-10-18T05:44:42Z'),
    userMessage('$flow-orchestrate make progress', '2026-10-18T05:44:43Z'),
    turnContext('t1', 'gpt-6.1-sol', '2026-10-18T05:44:44Z'),
    usageRecord(ROOT, ROOT, 't1', 'resp_1', { input: 30_000, cached: 22_000, output: 500 }, '2026-10-18T05:44:47Z'),
    usageRecord(ROOT, ROOT, 't1', 'resp_1', { input: 30_000, cached: 22_000, output: 500 }, '2026-10-18T05:44:47Z'), // duplicate response id
    functionCall('spawn_agent', { message: 'Task 1.1', agent_type: 'flow_executor', task_name: 'task_1_1', fork_turns: 'none' }, '2026-10-18T05:44:50Z', 'spawn-1'),
    functionOutput('spawn-1', JSON.stringify({ agent_id: CHILD, task_name: 'task_1_1', status: 'running' }), '2026-10-18T05:44:51Z'),
    functionCall('followup_task', { target: 'task_1_1', message: 'retry' }, '2026-10-18T05:50:00Z', 'f-1'),
    functionCall('send_message', { target: 'unknown_task', message: 'hi' }, '2026-10-18T05:51:00Z', 'f-2'),
    turnContext('t2', 'gpt-6-astra', '2026-10-18T06:10:00Z'),
    // 25 minutes idle → the cache expired: almost everything is re-read uncached.
    usageRecord(ROOT, ROOT, 't2', 'resp_2', { input: 120_000, cached: 2_000, output: 800 }, '2026-10-18T06:10:05Z'),
  ]);
  const child = await rollout('18', '05-44-51', CHILD, [
    meta(CHILD, project, { session_id: ROOT, parent_thread_id: ROOT, agent_role: 'flow_executor', agent_nickname: 'Ada' }),
    turnContext('c1', 'gpt-6.1-sol', '2026-10-18T05:44:52Z'),
    usageRecord(CHILD, ROOT, 'c1', 'resp_c1', { input: 8_000, cached: 1_000, output: 1_500 }, '2026-10-18T05:44:55Z'),
    usageRecord(CHILD, ROOT, 'c1', 'resp_c2', { input: 14_000, cached: 8_000, output: 900 }, '2026-10-18T05:45:30Z'),
  ]);
  await rollout('17', '23-00-00', OTHER, [
    meta(OTHER, '/somewhere/else'),
    turnContext('o1', 'gpt-6-luna', '2026-10-17T23:00:01Z'),
    usageRecord(OTHER, OTHER, 'o1', 'resp_o1', { input: 5_000, cached: 0, output: 100 }, '2026-10-17T23:00:05Z'),
  ]);
  return { root, child };
}

describe('Codex rollouts', () => {
  it('lists rollout files, reads session_meta cheaply and finds a thread by id', async () => {
    const { child } = await seedProject();
    const files = await listRolloutFiles(home);
    expect(files).toHaveLength(3);
    expect((await readSessionMeta(child))?.parent_thread_id).toBe(ROOT);
    expect(await findRolloutByThreadId(CHILD, home)).toBe(child);
    expect(await findRolloutByThreadId('nope', home)).toBeUndefined();
    expect(await readSessionMeta(path.join(home, 'missing.jsonl'))).toBeNull();
  });

  it('parses token_usage_record lines: uncached vs cached input, dedupe, model per turn, skills, spawns, continuations', async () => {
    const { root } = await seedProject();
    const parsed = await parseCodexRollout(root);
    expect(parsed.calls).toHaveLength(2);
    expect(parsed.calls[0]).toMatchObject({ key: 'resp_1', model: 'gpt-6.1-sol', skill: 'flow-orchestrate', sidechain: false, usage: { input: 8_000, cacheRead: 22_000, cacheWrite: 0, output: 500 } });
    expect(parsed.calls[1]).toMatchObject({ key: 'resp_2', model: 'gpt-6-astra', usage: { input: 118_000, cacheRead: 2_000 } });
    expect(parsed.spawns).toBe(1);
    expect(parsed.continuations).toEqual({ [CHILD]: 1, unknown_task: 1 });
    expect(parsed.cwd).toBe(project);
    expect(parsed.sessionId).toBe(ROOT);
  });

  it('marks a spawned thread as a subagent of its root session with its role', async () => {
    const { child } = await seedProject();
    const parsed = await parseCodexRollout(child);
    expect(parsed.calls.every((c) => c.sidechain && c.sessionId === ROOT && c.agentId === CHILD)).toBe(true);
    expect(parsed.agentTypes).toEqual({ [CHILD]: 'flow_executor' });
  });

  it('falls back to token_count events for older rollouts and honours --since', async () => {
    const file = await rollout('10', '10-00-00', OTHER, [
      meta(OTHER, project),
      turnContext('o1', 'gpt-5.6-sol', '2026-10-10T10:00:01Z'),
      tokenCount({ input: 1_000, cached: 200, output: 50 }, '2026-10-10T10:00:05Z'),
      tokenCount({ input: 3_000, cached: 900, output: 70 }, '2026-10-10T10:01:05Z'),
    ]);
    const parsed = await parseCodexRollout(file);
    expect(parsed.calls.map((c) => c.usage.input)).toEqual([800, 2_100]);
    expect(parsed.calls[0].model).toBe('gpt-5.6-sol');
    expect((await parseCodexRollout(file, new Date('2026-10-10T10:01:00Z'))).calls).toHaveLength(1);
  });

  it('finds this project\'s rollouts by cwd (children included) and --all finds every project', async () => {
    await seedProject();
    const mine = await findCodexRolloutFiles({ projectPath: project, dir: home });
    expect(mine.files.map((f) => path.basename(f))).toEqual(expect.arrayContaining([expect.stringContaining(ROOT), expect.stringContaining(CHILD)]));
    expect(mine.files).toHaveLength(2);
    expect(mine.source).toBe(path.join(home, 'sessions'));
    const all = await findCodexRolloutFiles({ projectPath: project, dir: home, all: true });
    expect(all.files).toHaveLength(3);
    const recent = await findCodexRolloutFiles({ projectPath: project, dir: home, all: true, since: new Date(Date.now() + 60_000) });
    expect(recent.files).toHaveLength(0);
  });

  it('reads compressed rollouts when Node can decode zstd, counts skipped ones otherwise', async () => {
    const file = await rollout('01', '01-00-00', OTHER, [meta(OTHER, project), turnContext('z1', 'gpt-6-luna', '2026-10-01T01:00:01Z'), usageRecord(OTHER, OTHER, 'z1', 'resp_z', { input: 700, cached: 100 }, '2026-10-01T01:00:05Z')], '.jsonl.zst');
    const found = await findCodexRolloutFiles({ projectPath: project, dir: home });
    if (canReadCompressedRollouts()) {
      expect(found.files).toEqual([file]);
      expect((await parseCodexRollout(file)).calls[0].usage).toMatchObject({ input: 600, cacheRead: 100 });
    } else {
      expect(found.files).toEqual([]);
      expect(found.skippedCompressed).toBe(1);
    }
  });

  it('builds a report with OpenAI weights, subagent attribution and cold re-reads after idle gaps', async () => {
    await seedProject();
    const { files, source } = await findCodexRolloutFiles({ projectPath: project, dir: home });
    const report = await buildCodexUsageReport(files, source, { idleMinutes: 5 });
    expect(report.agent).toBe('codex');
    expect(report.weights).toEqual({ input: 1, cacheWrite: 1, cacheRead: 0.1, output: 8 });
    expect(report.sessions).toHaveLength(1);
    const s = report.sessions[0];
    expect(s.sessionId).toBe(ROOT);
    expect(s.totals.calls).toBe(4);
    expect(s.main.calls).toBe(2);
    expect(s.subagents).toMatchObject({ calls: 2, input: 13_000, cacheRead: 9_000, output: 2_400 });
    expect(s.peakContext).toBe(120_000);
    expect(report.byModel['gpt-6-astra'].calls).toBe(1);
    expect(report.bySkill['flow-orchestrate'].calls).toBe(2);
    expect(report.bySkill['agent:flow_executor'].calls).toBe(2);
    expect(report.byAgentType.flow_executor).toMatchObject({ agents: 1, continuations: 1 });
    expect(report.agents[0]).toMatchObject({ agentId: CHILD, type: 'flow_executor', peakContext: 14_000, continuations: 1 });
    expect(report.spawns).toBe(1);
    const idle = report.cacheBreaks.filter((b) => b.reason === 'idle');
    expect(idle).toHaveLength(1);
    expect(idle[0]).toMatchObject({ cacheWrite: 118_000, gapMinutes: 25.3 });
    expect(inputEquivalent(s.totals, report.weights)).toBe(Math.round(139_000 + 3_300 + 8 * 3_700));

    const text = formatUsageReport(report, 5);
    expect(text).toContain('Observed API usage from Codex rollouts');
    expect(text).toContain('uncached input');
    expect(text).toContain('cached input');
    expect(text).toContain('Large uncached re-reads');
    expect(text).toContain('followup_task/send_message continuations 2');
    expect(text).not.toContain('CLAUDE.md');
  });

  it('usage --agent codex prints the report for this project; the other project needs --all', async () => {
    await seedProject();
    await runUsage({ cwd: project, agent: 'codex', dir: home });
    expect(logged()).toContain('Codex rollouts');
    expect(logged()).toContain(ROOT.slice(0, 8));
    vi.mocked(console.log).mockClear();
    await runUsage({ cwd: '/nowhere/at/all', agent: 'codex', dir: home });
    expect(logged()).toContain('no Codex rollouts found');
    expect(logged()).toContain('--agent codex --all');
  });

  it('doctor --tokens checks AGENTS.md, Codex hooks and roles, and last-7d Codex usage for a Codex project', async () => {
    await seedProject();
    await fs.outputFile(path.join(project, 'AGENTS.md'), '# AGENTS\n\nshort\n');
    await fs.outputJson(path.join(project, '.agent-flow', 'config.json'), { adapters: { codex: true } });
    const checks = await collectTokenChecks(project, { codexDir: home, since: new Date('2026-10-17T00:00:00Z') });
    const labels = checks.map((c) => c.label);
    expect(labels.some((l) => l.startsWith('Codex always-loaded instructions'))).toBe(true);
    expect(labels).toContain('Codex guard hooks missing');
    expect(labels.some((l) => l.startsWith('Codex agent roles missing'))).toBe(true);
    expect(labels.some((l) => l.startsWith('Codex, last 7d: peak context 120k'))).toBe(true);
    expect(labels.some((l) => l.startsWith('Claude Code'))).toBe(false);
  });
});

import path from 'node:path';
import os from 'node:os';
import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runGuard } from '../src/commands/guard.js';
import { collectTokenChecks } from '../src/commands/doctor-tokens.js';
import { ensureGitignore, GITIGNORE_ENTRIES, guardHookInstalled, installGuardHook } from '../src/core/claude-settings.js';
import { DEFAULT_GUARD, guardPrompt, guardTool, lastUsage, type GuardConfig } from '../src/core/guard.js';

let tmpDir: string;
const SESSION = 'sess-1';
const NOW = Date.parse('2026-09-30T12:00:00Z');
const cfg: GuardConfig = { ...DEFAULT_GUARD, executorBudgetTokens: 150_000 };

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-flow-guard-test-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.remove(tmpDir);
});

function assistantRow(at: string, context: number) {
  return {
    type: 'assistant',
    timestamp: at,
    sessionId: SESSION,
    message: { model: 'claude-test', usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: context - 10, output_tokens: 5 } },
  };
}

async function transcript(rows: unknown[], file = path.join(tmpDir, 'projects', 'p', `${SESSION}.jsonl`)): Promise<string> {
  await fs.ensureDir(path.dirname(file));
  await fs.writeFile(file, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
  return file;
}

const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

describe('lastUsage', () => {
  it('reads the last real assistant usage from the tail', async () => {
    const file = await transcript([
      assistantRow(minutesAgo(10), 50_000),
      assistantRow(minutesAgo(2), 120_000),
      { type: 'assistant', timestamp: minutesAgo(1), message: { model: '<synthetic>', usage: { input_tokens: 1 } } },
      { type: 'user', message: { content: 'hi' } },
    ]);
    expect(await lastUsage(file)).toEqual({ context: 120_000, at: minutesAgo(2) });
  });

  it('returns null for a missing file', async () => {
    expect(await lastUsage(path.join(tmpDir, 'nope.jsonl'))).toBeNull();
  });
});

describe('guardPrompt', () => {
  it('warns on a cold resume of a big session', async () => {
    const file = await transcript([assistantRow(minutesAgo(40), 400_000)]);
    const v = await guardPrompt({ transcript_path: file, session_id: SESSION }, cfg, tmpDir, NOW);
    expect(v.block).toBeFalsy();
    expect(v.message).toContain('40 min since the last reply');
    expect(v.message).toContain('~400k tokens');
  });

  it('stays quiet for a warm or small session', async () => {
    const warm = await transcript([assistantRow(minutesAgo(1), 150_000)]);
    expect(await guardPrompt({ transcript_path: warm, session_id: SESSION }, cfg, tmpDir, NOW)).toEqual({});
    const small = await transcript([assistantRow(minutesAgo(60), 30_000)]);
    expect(await guardPrompt({ transcript_path: small, session_id: SESSION }, cfg, tmpDir, NOW)).toEqual({});
  });

  it('warns when a warm session is past its budget', async () => {
    const file = await transcript([assistantRow(minutesAgo(1), 450_000)]);
    const v = await guardPrompt({ transcript_path: file, session_id: SESSION }, cfg, tmpDir, NOW);
    expect(v.message).toContain('re-reads ~450k tokens (budget 200k)');
  });

  it('blockColdResume blocks the first cold prompt once, then lets a re-send through', async () => {
    const file = await transcript([assistantRow(minutesAgo(30), 300_000)]);
    const strict = { ...cfg, blockColdResume: true };
    const first = await guardPrompt({ transcript_path: file, session_id: SESSION }, strict, tmpDir, NOW);
    expect(first.block).toBe(true);
    const second = await guardPrompt({ transcript_path: file, session_id: SESSION }, strict, tmpDir, NOW + 30_000);
    expect(second.block).toBeFalsy();
    expect(second.message).toBeDefined();
  });

  it('does nothing when disabled', async () => {
    const file = await transcript([assistantRow(minutesAgo(40), 400_000)]);
    expect(await guardPrompt({ transcript_path: file }, { ...cfg, enabled: false }, tmpDir, NOW)).toEqual({});
  });
});

describe('guardTool', () => {
  async function subagentTranscript(context: number): Promise<{ main: string; sub: string }> {
    const main = await transcript([assistantRow(minutesAgo(1), 900_000)]);
    const sub = await transcript([assistantRow(minutesAgo(1), context)], path.join(path.dirname(main), SESSION, 'subagents', 'agent-abc.jsonl'));
    return { main, sub };
  }

  it('denies an executor past its budget, identified via agent_id', async () => {
    const { main } = await subagentTranscript(180_000);
    const v = await guardTool({ transcript_path: main, session_id: SESSION, agent_id: 'abc', tool_name: 'Read', tool_input: { file_path: 'src/a.ts' } }, cfg);
    expect(v.deny).toContain('past the executor budget (150k)');
    expect(v.deny).toContain('.agent-flow/handoffs/');
  });

  it('still lets the executor write its handoff', async () => {
    const { main } = await subagentTranscript(180_000);
    const v = await guardTool({ transcript_path: main, session_id: SESSION, agent_id: 'abc', tool_name: 'Write', tool_input: { file_path: '/repo/.agent-flow/handoffs/1.2.md' } }, cfg);
    expect(v).toEqual({});
  });

  it('allows executors under budget', async () => {
    const { main } = await subagentTranscript(90_000);
    expect(await guardTool({ transcript_path: main, session_id: SESSION, agent_id: 'abc', tool_name: 'Read' }, cfg)).toEqual({});
  });

  it('never enforces on the main thread or an unidentified transcript', async () => {
    const { main } = await subagentTranscript(180_000);
    expect(await guardTool({ transcript_path: main, session_id: SESSION, tool_name: 'Read' }, cfg)).toEqual({});
    expect(await guardTool({ transcript_path: main, session_id: SESSION, agent_id: 'unknown', tool_name: 'Read' }, cfg)).toEqual({});
  });

  it('accepts a subagent transcript path directly and respects enforceExecutors: false', async () => {
    const { sub } = await subagentTranscript(180_000);
    expect((await guardTool({ transcript_path: sub, tool_name: 'Read' }, cfg)).deny).toBeDefined();
    expect(await guardTool({ transcript_path: sub, tool_name: 'Read' }, { ...cfg, enforceExecutors: false })).toEqual({});
  });
});

describe('agent-flow guard command', () => {
  it('prints a systemMessage for prompt warnings and a deny decision for tools', async () => {
    const main = await transcript([assistantRow(new Date(Date.now() - 40 * 60_000).toISOString(), 400_000)]);
    await runGuard('prompt', { cwd: tmpDir, input: JSON.stringify({ transcript_path: main, session_id: SESSION }) });
    const out = JSON.parse(String(vi.mocked(console.log).mock.calls[0][0]));
    expect(out.systemMessage).toContain('agent-flow guard');

    vi.mocked(console.log).mockClear();
    const sub = await transcript([assistantRow(new Date().toISOString(), 400_000)], path.join(tmpDir, 'projects', 'p', SESSION, 'subagents', 'agent-x.jsonl'));
    await runGuard('tool', { cwd: tmpDir, input: JSON.stringify({ transcript_path: sub, tool_name: 'Bash' }) });
    const denial = JSON.parse(String(vi.mocked(console.log).mock.calls[0][0]));
    expect(denial.hookSpecificOutput).toMatchObject({ hookEventName: 'PreToolUse', permissionDecision: 'deny' });
  });

  it('never throws and prints nothing on garbage input', async () => {
    await expect(runGuard('prompt', { cwd: tmpDir, input: 'not json' })).resolves.toBeUndefined();
    await expect(runGuard('tool', { cwd: tmpDir, input: '{}' })).resolves.toBeUndefined();
    expect(vi.mocked(console.log)).not.toHaveBeenCalled();
  });
});

describe('installation', () => {
  it('merges the guard hook into existing settings, idempotently', async () => {
    await fs.ensureDir(path.join(tmpDir, '.claude'));
    await fs.writeJson(path.join(tmpDir, '.claude/settings.json'), {
      permissions: { allow: ['Bash(ls:*)'] },
      hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] },
    });
    expect((await installGuardHook(tmpDir)).status).toBe('overwritten');
    expect((await installGuardHook(tmpDir)).status).toBe('skipped');
    const settings = await fs.readJson(path.join(tmpDir, '.claude/settings.json'));
    expect(settings.permissions.allow).toEqual(['Bash(ls:*)']);
    expect(settings.hooks.UserPromptSubmit).toHaveLength(2);
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toBe('echo mine');
    expect(await guardHookInstalled(tmpDir)).toBe(true);
  });

  it('never overwrites unparseable settings', async () => {
    await fs.ensureDir(path.join(tmpDir, '.claude'));
    await fs.writeFile(path.join(tmpDir, '.claude/settings.json'), '{ // comment\n}');
    expect((await installGuardHook(tmpDir)).status).toBe('skipped');
    expect(await fs.readFile(path.join(tmpDir, '.claude/settings.json'), 'utf8')).toBe('{ // comment\n}');
  });

  it('appends only missing .gitignore entries', async () => {
    await fs.writeFile(path.join(tmpDir, '.gitignore'), 'node_modules\n.agent-flow/memory.db\n');
    await ensureGitignore(tmpDir);
    const content = await fs.readFile(path.join(tmpDir, '.gitignore'), 'utf8');
    expect(content.startsWith('node_modules\n.agent-flow/memory.db\n')).toBe(true);
    expect(content.match(/\.agent-flow\/memory\.db/g)).toHaveLength(1);
    for (const entry of GITIGNORE_ENTRIES) expect(content).toContain(entry);
    expect((await ensureGitignore(tmpDir)).status).toBe('skipped');
  });
});

describe('doctor --tokens', () => {
  it('flags heavy always-loaded instructions and many MCP servers, and reads recent usage', async () => {
    await fs.writeFile(path.join(tmpDir, 'CLAUDE.md'), '@AGENTS.md\n');
    await fs.writeFile(path.join(tmpDir, 'AGENTS.md'), 'x'.repeat(20_000));
    await fs.writeJson(path.join(tmpDir, '.mcp.json'), { mcpServers: Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`s${i}`, {}])) });
    const claudeDir = path.join(tmpDir, 'claude-home');
    const slug = path.resolve(tmpDir).replace(/[^a-zA-Z0-9]/g, '-');
    await transcript([assistantRow(new Date().toISOString(), 300_000)], path.join(claudeDir, 'projects', slug, 's.jsonl'));

    const checks = await collectTokenChecks(tmpDir, { claudeDir });
    const byLabel = (re: RegExp) => checks.find((c) => re.test(c.label));
    expect(byLabel(/always-loaded/)).toMatchObject({ level: 'warning' });
    expect(byLabel(/always-loaded/)?.detail).toContain('CLAUDE.md + AGENTS.md');
    expect(byLabel(/MCP servers: 7/)).toMatchObject({ level: 'warning' });
    expect(byLabel(/guard hook missing/)).toMatchObject({ level: 'warning' });
    expect(byLabel(/peak context 300k/)).toMatchObject({ level: 'warning' });
  });
});

import path from 'node:path';
import os from 'node:os';
import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseAdapters, resolveAdapters, runInit } from '../src/commands/init.js';
import { detectInstalledRuntimes } from '../src/core/detect-runtimes.js';

let tmpDir: string;
let homes: string;
const saved = { codex: process.env.CODEX_HOME, claude: process.env.CLAUDE_CONFIG_DIR, ci: process.env.CI };

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-flow-init-choose-'));
  homes = path.join(tmpDir, 'homes');
  process.env.CODEX_HOME = path.join(homes, 'codex');
  process.env.CLAUDE_CONFIG_DIR = path.join(homes, 'claude');
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.remove(tmpDir);
  process.env.CODEX_HOME = saved.codex;
  process.env.CLAUDE_CONFIG_DIR = saved.claude;
  process.env.CI = saved.ci;
  if (saved.codex === undefined) delete process.env.CODEX_HOME;
  if (saved.claude === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  if (saved.ci === undefined) delete process.env.CI;
});

function logged(): string {
  return vi.mocked(console.log).mock.calls.map((call) => String(call[0])).join('\n');
}

async function haveRuntimes(...ids: Array<'codex' | 'claude'>): Promise<void> {
  for (const id of ids) await fs.ensureDir(path.join(homes, id));
}

describe('runtime detection', () => {
  it('reports the runtimes whose home folders exist, codex first', async () => {
    expect(await detectInstalledRuntimes()).toEqual([]);
    await haveRuntimes('claude');
    expect(await detectInstalledRuntimes()).toEqual(['claude']);
    await haveRuntimes('codex');
    expect(await detectInstalledRuntimes()).toEqual(['codex', 'claude']);
  });
});

describe('resolveAdapters', () => {
  it('returns null when no flag says anything, [] for --agent none, and rejects unknown agents', () => {
    expect(resolveAdapters({})).toBeNull();
    expect(resolveAdapters({ agent: 'none' })).toEqual([]);
    expect(resolveAdapters({ agent: 'all' })).toEqual(['codex', 'claude']);
    expect(resolveAdapters({ claude: true })).toEqual(['claude']);
    expect(() => resolveAdapters({ agent: 'gemini' })).toThrow('Allowed values: codex, claude, all, none');
  });
});

describe('chooseAdapters', () => {
  it('non-interactive: installs what the machine has and says so', async () => {
    await haveRuntimes('codex');
    expect(await chooseAdapters({ interactive: false })).toEqual(['codex']);
    expect(logged()).toContain('detected on this machine: Codex → installing Codex');
    await haveRuntimes('claude');
    expect(await chooseAdapters({ interactive: false })).toEqual(['codex', 'claude']);
  });

  it('non-interactive with nothing detected: base files only', async () => {
    expect(await chooseAdapters({ interactive: false })).toEqual([]);
    expect(logged()).toContain('installing base files only');
  });

  it('interactive: the detected runtimes are the default answer, an explicit answer wins', async () => {
    await haveRuntimes('claude');
    const questions: string[] = [];
    const answer = (value: string) => async (q: string) => { questions.push(q); return value; };
    expect(await chooseAdapters({ interactive: true, ask: answer('') })).toEqual(['claude']);
    expect(questions[0]).toContain('[2]');
    expect(await chooseAdapters({ interactive: true, ask: answer('3') })).toEqual(['codex', 'claude']);
    expect(await chooseAdapters({ interactive: true, ask: answer('4') })).toEqual([]);
    await expect(chooseAdapters({ interactive: true, ask: answer('9') })).rejects.toThrow('Invalid choice: 9');
    expect(logged()).toContain('Detected on this machine: Claude Code.');
  });

  it('defaults to non-interactive under CI even with a TTY', async () => {
    process.env.CI = '1';
    await haveRuntimes('codex');
    const ask = vi.fn(async () => '2');
    expect(await chooseAdapters({ ask })).toEqual(['codex']);
    expect(ask).not.toHaveBeenCalled();
  });
});

describe('init without adapter flags', () => {
  it('installs the detected runtime and records it in the config', async () => {
    await haveRuntimes('codex');
    await runInit({ cwd: tmpDir, interactive: false });
    await expect(fs.pathExists(path.join(tmpDir, '.agents/skills/flow-orchestrate/SKILL.md'))).resolves.toBe(true);
    await expect(fs.pathExists(path.join(tmpDir, 'CLAUDE.md'))).resolves.toBe(false);
    expect((await fs.readJson(path.join(tmpDir, '.agent-flow/config.json'))).adapters).toEqual({ codex: true, claude: false });
  });

  it('follows the interactive answer', async () => {
    await runInit({ cwd: tmpDir, interactive: true, ask: async () => '2' });
    await expect(fs.pathExists(path.join(tmpDir, 'CLAUDE.md'))).resolves.toBe(true);
    await expect(fs.pathExists(path.join(tmpDir, '.codex/hooks.json'))).resolves.toBe(false);
  });

  it('--agent none never asks and writes base files only', async () => {
    await haveRuntimes('codex', 'claude');
    const ask = vi.fn(async () => '3');
    await runInit({ cwd: tmpDir, agent: 'none', interactive: true, ask });
    expect(ask).not.toHaveBeenCalled();
    await expect(fs.pathExists(path.join(tmpDir, 'AGENTS.md'))).resolves.toBe(true);
    await expect(fs.pathExists(path.join(tmpDir, '.agents'))).resolves.toBe(false);
    await expect(fs.pathExists(path.join(tmpDir, '.claude'))).resolves.toBe(false);
    expect((await fs.readJson(path.join(tmpDir, '.agent-flow/config.json'))).adapters).toEqual({ codex: false, claude: false });
  });
});

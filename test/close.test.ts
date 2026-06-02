import path from 'node:path';
import os from 'node:os';
import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runClose } from '../src/commands/close.js';
import { readMemoryEntries } from '../src/core/jsonl-memory.js';
import { createProgram } from '../src/cli.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-flow-close-test-'));
  await fs.ensureDir(path.join(tmpDir, '.memory'));
  await fs.writeFile(path.join(tmpDir, '.memory/events.jsonl'), '');
  await fs.writeFile(path.join(tmpDir, '.memory/decisions.jsonl'), '');
  await fs.writeFile(path.join(tmpDir, '.memory/errors.jsonl'), '');
  await fs.writeFile(path.join(tmpDir, '.memory/modules.jsonl'), '');
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.remove(tmpDir);
});

function output(): string {
  return vi.mocked(console.log).mock.calls.map((call) => String(call[0])).join('\n');
}

describe('close command', () => {
  it('is registered in the CLI', () => {
    const cmd = createProgram().commands.find((c) => c.name() === 'close');
    expect(cmd).toBeDefined();
    expect(cmd?.helpInformation()).toContain('--change');
    expect(cmd?.helpInformation()).toContain('--decision');
    expect(cmd?.helpInformation()).toContain('--error');
    expect(cmd?.helpInformation()).toContain('--next');
    expect(cmd?.helpInformation()).toContain('--module');
    expect(cmd?.helpInformation()).toContain('--allow-duplicate');
  });

  it('saves change memory with --change flag', async () => {
    await runClose({ cwd: tmpDir, change: 'Added webhook idempotency' });

    const entries = await readMemoryEntries(tmpDir);
    expect(entries).toHaveLength(1);
    const value = entries[0].value as Record<string, unknown>;
    expect(value.type).toBe('change');
    expect(value.summary).toBe('Added webhook idempotency');
  });

  it('saves decision memory with --decision flag', async () => {
    await runClose({ cwd: tmpDir, decision: 'Use event ids for dedup' });

    const entries = await readMemoryEntries(tmpDir);
    expect(entries).toHaveLength(1);
    const value = entries[0].value as Record<string, unknown>;
    expect(value.type).toBe('decision');
    expect(value.summary).toBe('Use event ids for dedup');
  });

  it('saves error memory with --error flag', async () => {
    await runClose({ cwd: tmpDir, error: 'Build failed on missing env' });

    const entries = await readMemoryEntries(tmpDir);
    expect(entries).toHaveLength(1);
    const value = entries[0].value as Record<string, unknown>;
    expect(value.type).toBe('error');
    expect(value.summary).toBe('Build failed on missing env');
  });

  it('saves handoff memory with --next flag', async () => {
    await runClose({ cwd: tmpDir, next: 'Continue with retry logic' });

    const entries = await readMemoryEntries(tmpDir);
    expect(entries).toHaveLength(1);
    const value = entries[0].value as Record<string, unknown>;
    expect(value.type).toBe('handoff');
    expect(value.summary).toBe('Continue with retry logic');
  });

  it('saves multiple entries at once', async () => {
    await runClose({
      cwd: tmpDir,
      change: 'Fixed webhook',
      decision: 'Chose idempotent design',
      module: 'billing',
    });

    const entries = await readMemoryEntries(tmpDir);
    expect(entries).toHaveLength(2);
    expect((entries[0].value as Record<string, unknown>).module).toBe('billing');
    expect((entries[1].value as Record<string, unknown>).module).toBe('billing');
  });

  it('skips duplicate entries gracefully', async () => {
    await runClose({ cwd: tmpDir, change: 'Added webhook idempotency' });
    await runClose({ cwd: tmpDir, change: 'Added webhook idempotency' });

    const entries = await readMemoryEntries(tmpDir);
    expect(entries).toHaveLength(1);
  });

  it('prints usage in non-interactive mode with no flags', async () => {
    const origTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    try {
      await runClose({ cwd: tmpDir });
      const out = output();
      expect(out).toContain('Non-interactive mode');
      expect(out).toContain('--change');
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: origTTY, configurable: true });
    }
  });
});

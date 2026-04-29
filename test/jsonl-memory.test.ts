import path from 'node:path';
import os from 'node:os';
import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMemoryAppend, runMemoryContext, runMemorySearch, runMemoryValidate } from '../src/commands/memory.js';
import { appendMemoryEntry } from '../src/core/jsonl-memory.js';
import { validateMemoryValue } from '../src/core/memory-schemas.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-flow-memory-test-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  process.exitCode = undefined;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.remove(tmpDir);
  process.exitCode = undefined;
});

describe('JSONL memory append', () => {
  it('validates memory schemas by file', () => {
    expect(validateMemoryValue('events', {
      createdAt: '2026-01-01T00:00:00.000Z',
      type: 'change',
      summary: 'Added memory validation.',
      files: ['src/core/jsonl-memory.ts'],
      tags: ['memory'],
    })).toEqual({ ok: true });

    const moduleResult = validateMemoryValue('modules', {
      createdAt: '2026-01-01T00:00:00.000Z',
      type: 'module',
      summary: 'Missing module name.',
    });

    expect(moduleResult.ok).toBe(false);

    expect(validateMemoryValue('decisions', {
      createdAt: '2026-01-01T00:00:00.000Z',
      type: 'decision',
      summary: 'Keep local JSONL memory.',
      status: 'accepted',
      rationale: 'Keeps the v0.3.0 scope narrow.',
      alternatives: ['SQLite', 'semantic search'],
    })).toEqual({ ok: true });

    expect(validateMemoryValue('errors', {
      createdAt: '2026-01-01T00:00:00.000Z',
      type: 'error',
      summary: 'Append rejected invalid memory.',
      cause: 'Missing module field.',
      solution: 'Pass --module.',
    })).toEqual({ ok: true });
  });

  it('appends one JSON object per line and adds createdAt', async () => {
    await appendMemoryEntry(tmpDir, 'events', {
      type: 'event',
      summary: 'Initial onboarding complete',
    });
    await appendMemoryEntry(tmpDir, 'events', {
      type: 'event',
      summary: 'Second event',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    const lines = (await fs.readFile(path.join(tmpDir, '.memory/events.jsonl'), 'utf8')).trim().split('\n');

    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toMatchObject({
      type: 'event',
      summary: 'Initial onboarding complete',
    });
    expect(JSON.parse(lines[0]).createdAt).toEqual(expect.any(String));
    expect(JSON.parse(lines[1])).toMatchObject({
      type: 'event',
      summary: 'Second event',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('rejects entries without type or summary', async () => {
    await expect(appendMemoryEntry(tmpDir, 'events', { type: '', summary: 'Missing type' })).rejects.toThrow(
      'non-empty type',
    );
    await expect(appendMemoryEntry(tmpDir, 'events', { type: 'event', summary: '' })).rejects.toThrow(
      'non-empty summary',
    );
  });

  it('memory append command creates valid JSONL', async () => {
    await runMemoryAppend({
      cwd: tmpDir,
      file: 'events',
      type: 'event',
      summary: 'Documented initial architecture',
      module: 'billing',
    });

    const raw = await fs.readFile(path.join(tmpDir, '.memory/events.jsonl'), 'utf8');
    const entry = JSON.parse(raw.trim());

    expect(entry).toMatchObject({
      type: 'event',
      summary: 'Documented initial architecture',
      module: 'billing',
    });
    expect(entry.createdAt).toEqual(expect.any(String));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('appended .memory/events.jsonl:1'));
  });

  it('rejects invalid memory for the target file', async () => {
    await expect(runMemoryAppend({
      cwd: tmpDir,
      file: 'modules',
      type: 'module',
      summary: 'Module entry without a module name',
    })).rejects.toThrow('Invalid modules memory entry');

    expect(await fs.pathExists(path.join(tmpDir, '.memory/modules.jsonl'))).toBe(false);
  });

  it('prevents exact duplicates by default and allows them with a flag', async () => {
    await runMemoryAppend({
      cwd: tmpDir,
      file: 'events',
      type: 'change',
      summary: 'Added memory filters',
      module: 'memory',
    });

    await expect(runMemoryAppend({
      cwd: tmpDir,
      file: 'events',
      type: 'change',
      summary: '  Added   memory filters ',
      module: 'memory',
    })).rejects.toThrow('Duplicate memory entry');

    await runMemoryAppend({
      cwd: tmpDir,
      file: 'events',
      type: 'change',
      summary: 'Added memory filters',
      module: 'memory',
      allowDuplicate: true,
    });

    const lines = (await fs.readFile(path.join(tmpDir, '.memory/events.jsonl'), 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
  });

  it('filters memory search by file, type, module, and limit', async () => {
    await appendMemoryEntry(tmpDir, 'events', {
      type: 'change',
      summary: 'Updated billing state handling.',
      module: 'billing',
    });
    await appendMemoryEntry(tmpDir, 'events', {
      type: 'note',
      summary: 'Updated billing docs.',
      module: 'billing',
    });
    await appendMemoryEntry(tmpDir, 'modules', {
      type: 'module',
      summary: 'Billing module owns invoices.',
      module: 'billing',
    });

    vi.mocked(console.log).mockClear();
    await runMemorySearch('billing', {
      cwd: tmpDir,
      file: 'events',
      type: 'change',
      module: 'billing',
      limit: 1,
    });

    const output = vi.mocked(console.log).mock.calls.map((call) => String(call[0])).join('\n');
    expect(output).toContain('.memory/events.jsonl:1');
    expect(output).not.toContain('.memory/events.jsonl:2');
    expect(output).not.toContain('.memory/modules.jsonl');
  });

  it('prints a compact memory context pack', async () => {
    await appendMemoryEntry(tmpDir, 'events', {
      type: 'change',
      summary: 'Updated billing checkout flow.',
      module: 'billing',
    });
    await appendMemoryEntry(tmpDir, 'modules', {
      type: 'module',
      summary: 'Billing module owns checkout and invoices.',
      module: 'billing',
    });
    await appendMemoryEntry(tmpDir, 'decisions', {
      type: 'decision',
      summary: 'Keep billing state in local storage.',
      status: 'accepted',
    });
    await appendMemoryEntry(tmpDir, 'errors', {
      type: 'error',
      summary: 'Billing checkout failed on missing price id.',
      cause: 'Missing env value.',
      solution: 'Validate env before checkout.',
    });

    vi.mocked(console.log).mockClear();
    await runMemoryContext('billing', { cwd: tmpDir, limit: 2 });

    const output = vi.mocked(console.log).mock.calls.map((call) => String(call[0])).join('\n');
    expect(output).toContain('agent-flow memory context: billing');
    expect(output).toContain('Recent relevant events:');
    expect(output).toContain('Matching modules:');
    expect(output).toContain('Matching decisions:');
    expect(output).toContain('Matching errors:');
    expect(output).toContain('Suggested next usage in Codex');
  });

  it('memory validate passes valid memory', async () => {
    await appendMemoryEntry(tmpDir, 'events', {
      type: 'change',
      summary: 'Updated memory validation.',
    });
    await appendMemoryEntry(tmpDir, 'modules', {
      type: 'module',
      summary: 'Memory command owns validation output.',
      module: 'memory',
    });

    vi.mocked(console.log).mockClear();
    await runMemoryValidate({ cwd: tmpDir });

    const output = vi.mocked(console.log).mock.calls.map((call) => String(call[0])).join('\n');
    expect(output).toContain('agent-flow memory validate');
    expect(output).toContain('ok memory entries valid');
    expect(process.exitCode).toBeUndefined();
  });

  it('memory validate reports invalid JSONL with file and line', async () => {
    await fs.ensureDir(path.join(tmpDir, '.memory'));
    await fs.writeFile(path.join(tmpDir, '.memory/events.jsonl'), '{bad json\n');

    vi.mocked(console.log).mockClear();
    await runMemoryValidate({ cwd: tmpDir });

    const output = vi.mocked(console.log).mock.calls.map((call) => String(call[0])).join('\n');
    expect(output).toContain('fail 1 invalid memory entry');
    expect(output).toContain('.memory/events.jsonl:1');
    expect(output).toContain('error entry: Invalid JSON');
    expect(output).toContain('fix: Fix the JSON syntax');
    expect(process.exitCode).toBe(1);
  });

  it('memory validate reports invalid schema with file, line, and field path', async () => {
    await fs.ensureDir(path.join(tmpDir, '.memory'));
    await fs.writeFile(path.join(tmpDir, '.memory/events.jsonl'), JSON.stringify({
      createdAt: '2026-01-01T00:00:00.000Z',
      type: 'change',
    }) + '\n');

    vi.mocked(console.log).mockClear();
    await runMemoryValidate({ cwd: tmpDir });

    const output = vi.mocked(console.log).mock.calls.map((call) => String(call[0])).join('\n');
    expect(output).toContain('.memory/events.jsonl:1');
    expect(output).toContain('error summary: Required');
    expect(output).toContain('fix: Add a short durable summary string.');
    expect(process.exitCode).toBe(1);
  });

  it('memory validate reports old module entries without module with a useful fix', async () => {
    await fs.ensureDir(path.join(tmpDir, '.memory'));
    await fs.writeFile(path.join(tmpDir, '.memory/modules.jsonl'), JSON.stringify({
      createdAt: '2026-01-01T00:00:00.000Z',
      type: 'module',
      summary: 'Legacy module entry.',
    }) + '\n');

    vi.mocked(console.log).mockClear();
    await runMemoryValidate({ cwd: tmpDir });

    const output = vi.mocked(console.log).mock.calls.map((call) => String(call[0])).join('\n');
    expect(output).toContain('.memory/modules.jsonl:1');
    expect(output).toContain('summary: Legacy module entry.');
    expect(output).toContain('error module: Required');
    expect(output).toContain('fix: Add module with the module or area name, or re-add using --module.');
    expect(process.exitCode).toBe(1);
  });
});

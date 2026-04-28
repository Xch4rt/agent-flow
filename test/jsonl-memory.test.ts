import path from 'node:path';
import os from 'node:os';
import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMemoryAppend } from '../src/commands/memory.js';
import { appendMemoryEntry } from '../src/core/jsonl-memory.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-flow-memory-test-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.remove(tmpDir);
});

describe('JSONL memory append', () => {
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
});

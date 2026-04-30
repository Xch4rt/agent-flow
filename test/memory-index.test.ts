import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runContext } from '../src/commands/context.js';
import { runMemoryInspect, runMemoryQuery, runMemoryRebuild } from '../src/commands/memory.js';
import { runStatus } from '../src/commands/status.js';
import { getMemoryDbPath, getMemoryIndexState, queryMemoryIndex, rebuildMemoryIndex } from '../src/core/memory-index.js';
import { appendMemoryEntry } from '../src/core/jsonl-memory.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-flow-index-test-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.remove(tmpDir);
});

async function writeProject(): Promise<void> {
  await fs.ensureDir(path.join(tmpDir, '.planning'));
  await fs.writeFile(path.join(tmpDir, '.planning/STATE.md'), '# State\n\n## Current Status\n\nBilling work is active.\n');
  await fs.writeFile(path.join(tmpDir, '.planning/PROJECT.md'), '# Project\n\n## Purpose\n\nIndex test project.\n');
  await fs.writeFile(path.join(tmpDir, '.planning/DECISIONS.md'), '- Billing webhooks stay idempotent.\n');
  await fs.writeFile(path.join(tmpDir, '.planning/OPEN_QUESTIONS.md'), '- Should billing webhook alerts notify support?\n');
  await fs.writeJson(path.join(tmpDir, 'package.json'), {
    scripts: {
      test: 'vitest run',
      typecheck: 'tsc --noEmit',
    },
  });
  await fs.writeFile(path.join(tmpDir, 'pnpm-lock.yaml'), '');
}

async function writeMemory(): Promise<void> {
  await appendMemoryEntry(tmpDir, 'modules', {
    type: 'module',
    module: 'billing',
    summary: 'Billing module owns Stripe webhook duplicate processing.',
  });
  await appendMemoryEntry(tmpDir, 'modules', {
    type: 'module',
    module: 'auth',
    summary: 'Auth module owns login sessions.',
  });
  await appendMemoryEntry(tmpDir, 'decisions', {
    type: 'decision',
    module: 'billing',
    status: 'accepted',
    summary: 'Billing webhook processing must be idempotent.',
  });
  await appendMemoryEntry(tmpDir, 'decisions', {
    type: 'decision',
    module: 'billing',
    status: 'superseded',
    summary: 'Billing webhook processing can rely on retry timing.',
  });
  await appendMemoryEntry(tmpDir, 'errors', {
    type: 'error',
    module: 'billing',
    summary: 'Billing webhook duplicate processing created duplicate credits.',
    cause: 'Missing event id guard.',
    solution: 'Persist event ids before applying credits.',
  });
  await appendMemoryEntry(tmpDir, 'events', {
    type: 'change',
    module: 'billing',
    summary: 'Billing webhook duplicate tests were reviewed.',
  });
}

function output(): string {
  return vi.mocked(console.log).mock.calls.map((call) => String(call[0])).join('\n');
}

function readLastSyncAt(root: string): string | undefined {
  const db = new Database(getMemoryDbPath(root), { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare("select value from index_metadata where key = 'last_sync_at'").get() as { value: string } | undefined;
    return row?.value;
  } finally {
    db.close();
  }
}

describe('SQLite memory index', () => {
  it('auto-creates the database on memory query and runs migrations', async () => {
    await writeProject();
    await writeMemory();

    await runMemoryQuery('billing webhook', { cwd: tmpDir, limit: 5 });

    const dbPath = getMemoryDbPath(tmpDir);
    expect(await fs.pathExists(dbPath)).toBe(true);
    const db = new Database(dbPath, { readonly: true });
    const tables = db.prepare("select name from sqlite_master where type = 'table'").all() as Array<{ name: string }>;
    db.close();
    expect(tables.map((table) => table.name)).toEqual(expect.arrayContaining([
      'projects',
      'modules',
      'memory_entries',
      'memory_links',
      'index_metadata',
    ]));
    expect(output()).toContain('agent-flow memory query: billing webhook');
    expect(output()).toContain('Billing webhook processing must be idempotent.');
  });

  it('sync imports JSONL entries and is idempotent', async () => {
    await writeProject();
    await writeMemory();

    const first = await rebuildMemoryIndex(tmpDir);
    const second = await rebuildMemoryIndex(tmpDir);

    expect('entries' in first ? first.entries : 0).toBe(6);
    expect('entries' in second ? second.entries : 0).toBe(6);
  });

  it('rebuild does not modify JSONL source files', async () => {
    await writeProject();
    await writeMemory();
    const eventsPath = path.join(tmpDir, '.memory/events.jsonl');
    const before = await fs.readFile(eventsPath, 'utf8');

    await runMemoryRebuild({ cwd: tmpDir });

    await expect(fs.readFile(eventsPath, 'utf8')).resolves.toBe(before);
    expect(output()).toContain('agent-flow memory rebuild');
    expect(output()).toContain('Indexed entries: 6');
  });

  it('inspect reports counts and tracked files', async () => {
    await writeProject();
    await writeMemory();
    await queryMemoryIndex('billing', { cwd: tmpDir });

    await runMemoryInspect({ cwd: tmpDir });

    const text = output();
    expect(text).toContain('agent-flow memory inspect');
    expect(text).toContain('DB exists: yes');
    expect(text).toContain('Index status: in sync');
    expect(text).toContain('decisions: 2');
    expect(text).toContain('.memory/events.jsonl: present');
  });

  it('inspect is read-only and reports stale state consistently', async () => {
    await writeProject();
    await writeMemory();
    await queryMemoryIndex('billing', { cwd: tmpDir });
    const dbPath = getMemoryDbPath(tmpDir);
    const beforeMtime = (await fs.stat(dbPath)).mtimeMs;
    const beforeLastSync = readLastSyncAt(tmpDir);
    await appendMemoryEntry(tmpDir, 'events', {
      type: 'change',
      module: 'billing',
      summary: 'Billing webhook inspect stale state changed.',
    });

    await runMemoryInspect({ cwd: tmpDir });

    const text = output();
    expect(text).toContain('Index status: stale');
    expect(text).toContain('Suggested command: agent-flow memory rebuild');
    expect((await fs.stat(dbPath)).mtimeMs).toBe(beforeMtime);
    expect(readLastSyncAt(tmpDir)).toBe(beforeLastSync);
  });

  it('detects stale index after JSONL changes', async () => {
    await writeProject();
    await writeMemory();
    await queryMemoryIndex('billing', { cwd: tmpDir });
    await appendMemoryEntry(tmpDir, 'events', {
      type: 'change',
      module: 'billing',
      summary: 'Billing webhook stale detection changed.',
    });

    const state = await getMemoryIndexState(tmpDir);
    expect(state.status).toBe('stale');
  });

  it('query supports filters, JSON output, and ranked drawer priority', async () => {
    await writeProject();
    await writeMemory();

    await runMemoryQuery('billing webhook', { cwd: tmpDir, module: 'billing', drawer: 'decisions', status: 'accepted', json: true });

    const parsed = JSON.parse(output());
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]).toMatchObject({
      drawer: 'decisions',
      module: 'billing',
      status: 'accepted',
    });
  });

  it('ranks decisions above errors, errors above modules, and modules above events for similarly relevant matches', async () => {
    await writeProject();
    await appendMemoryEntry(tmpDir, 'decisions', {
      type: 'decision',
      module: 'billing',
      status: 'accepted',
      summary: 'Billing webhook duplicate processing must be guarded.',
    });
    await appendMemoryEntry(tmpDir, 'errors', {
      type: 'error',
      module: 'billing',
      summary: 'Billing webhook duplicate processing failed.',
    });
    await appendMemoryEntry(tmpDir, 'modules', {
      type: 'module',
      module: 'billing',
      summary: 'Billing webhook duplicate processing module.',
    });
    await appendMemoryEntry(tmpDir, 'events', {
      type: 'change',
      module: 'billing',
      summary: 'Billing webhook duplicate processing changed.',
    });

    const result = await queryMemoryIndex('billing webhook duplicate processing', { cwd: tmpDir, limit: 4 });

    expect(result.entries.map((entry) => entry.drawer)).toEqual(['decisions', 'errors', 'modules', 'events']);
  });

  it('does not let a recent event with more tokens outrank a similarly relevant error', async () => {
    await writeProject();
    await appendMemoryEntry(tmpDir, 'errors', {
      type: 'error',
      module: 'billing',
      summary: 'Billing webhook duplicate processing failed.',
      createdAt: '2024-01-01T00:00:00.000Z',
    });
    await appendMemoryEntry(tmpDir, 'events', {
      type: 'change',
      module: 'billing',
      summary: 'Billing webhook billing webhook duplicate duplicate processing processing retry retry changed recently.',
      createdAt: new Date().toISOString(),
    });

    const result = await queryMemoryIndex('billing webhook duplicate processing', { cwd: tmpDir, limit: 2 });

    expect(result.entries[0].drawer).toBe('errors');
    expect(result.entries[1].drawer).toBe('events');
  });

  it('ranks superseded decisions lower than active decisions', async () => {
    await writeProject();
    await writeMemory();

    const result = await queryMemoryIndex('billing webhook processing', { cwd: tmpDir, drawer: 'decisions', limit: 2 });

    expect(result.entries[0].status).toBe('accepted');
    expect(result.entries[1].status).toBe('superseded');
  });

  it('status does not create the memory database', async () => {
    await writeProject();
    await writeMemory();

    await runStatus({ cwd: tmpDir });

    expect(await fs.pathExists(getMemoryDbPath(tmpDir))).toBe(false);
    expect(output()).toContain('Memory index DB: no');
    expect(output()).toContain('Memory index state: missing');
  });

  it('status does not sync or mutate an existing stale memory database', async () => {
    await writeProject();
    await writeMemory();
    await queryMemoryIndex('billing', { cwd: tmpDir });
    const dbPath = getMemoryDbPath(tmpDir);
    const beforeMtime = (await fs.stat(dbPath)).mtimeMs;
    const beforeLastSync = readLastSyncAt(tmpDir);
    await appendMemoryEntry(tmpDir, 'events', {
      type: 'change',
      module: 'billing',
      summary: 'Billing webhook status stale state changed.',
    });

    await runStatus({ cwd: tmpDir });

    expect(output()).toContain('Memory index state: stale');
    expect((await fs.stat(dbPath)).mtimeMs).toBe(beforeMtime);
    expect(readLastSyncAt(tmpDir)).toBe(beforeLastSync);
  });

  it('context uses SQLite when available and keeps output shape', async () => {
    await writeProject();
    await writeMemory();

    await runContext('fix billing webhook duplicate processing', { cwd: tmpDir });

    expect(await fs.pathExists(getMemoryDbPath(tmpDir))).toBe(true);
    expect(output()).toContain('# Context Pack');
    expect(output()).toContain('Relevant Modules:');
    expect(output()).toContain('Billing module owns Stripe webhook duplicate processing.');
    expect(output()).toContain('Relevant Decisions:');
    expect(output()).toContain('Relevant Errors:');
    expect(output()).not.toContain('Auth module owns login sessions.');
  });

  it('context falls back to JSONL when SQLite is unavailable', async () => {
    await writeProject();
    await writeMemory();
    await fs.writeFile(path.join(tmpDir, '.agent-flow'), 'not a directory');

    await runContext('fix billing webhook duplicate processing', { cwd: tmpDir });

    expect(output()).toContain('memory index unavailable; used JSONL fallback');
    expect(output()).toContain('Billing module owns Stripe webhook duplicate processing.');
  });
});

import crypto from 'node:crypto';
import path from 'node:path';
import Database from 'better-sqlite3';
import fs from 'fs-extra';
import {
  getInvalidMemoryEntries,
  getMemoryFilePath,
  getMemoryFileNames,
  readMemoryEntries,
  type MemoryEntry,
  type MemoryFileName,
} from './jsonl-memory.js';

export type MemoryDrawer = 'events' | 'modules' | 'decisions' | 'errors' | 'constraints' | 'commands' | 'files' | 'open_questions';

export type IndexedMemoryEntry = {
  id: number;
  drawer: MemoryDrawer;
  type: string;
  summary: string;
  body?: string;
  module?: string;
  status?: string;
  source?: string;
  confidence?: string;
  stableKey: string;
  createdAt: string;
  updatedAt: string;
  lastSeenAt?: string;
  score?: number;
};

export type MemoryQueryOptions = {
  cwd?: string;
  module?: string;
  drawer?: string;
  type?: string;
  status?: string;
  limit?: number;
};

export type MemoryIndexSyncResult = {
  dbPath: string;
  projectId: number;
  imported: number;
  updated: number;
  skippedInvalid: number;
  entries: number;
  warnings: string[];
};

export type MemoryIndexState = {
  dbPath: string;
  exists: boolean;
  status: 'missing' | 'in sync' | 'stale';
  lastSyncAt?: string;
  trackedFiles: Array<{ file: string; exists: boolean; signature?: string; trackedSignature?: string }>;
};

export type MemoryIndexInspect = {
  dbPath: string;
  exists: boolean;
  status: MemoryIndexState['status'];
  projectCount: number;
  moduleCount: number;
  entryCounts: Record<string, number>;
  invalidEntries: number;
  lastSyncAt?: string;
  trackedFiles: MemoryIndexState['trackedFiles'];
};

type ProjectRow = {
  id: number;
};

type EntryRow = {
  id: number;
  drawer: MemoryDrawer;
  type: string;
  summary: string;
  body: string | null;
  module: string | null;
  status: string | null;
  source: string | null;
  confidence: string | null;
  stable_key: string;
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
};

const schemaVersion = '1';
const drawerPriority: Record<string, number> = {
  decisions: 40,
  errors: 34,
  modules: 28,
  events: 12,
};
const activeStatuses = new Set(['accepted', 'active', 'current', 'approved', 'implemented', 'resolved']);
const inactiveStatuses = new Set(['superseded', 'deprecated', 'rejected', 'inactive', 'obsolete']);

export function getMemoryDbPath(root: string): string {
  return path.join(root, '.agent-flow', 'memory.db');
}

function now(): string {
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  return typeof value[key] === 'string' ? value[key] : undefined;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function tokensFor(value: string): string[] {
  return [...new Set(normalize(value).split(/\s+/).filter((token) => token.length > 1))];
}

function hashStableKey(parts: string[]): string {
  return crypto.createHash('sha1').update(parts.join('\0')).digest('hex');
}

function stableKey(drawer: MemoryFileName, value: Record<string, unknown>, raw: string): string {
  return hashStableKey([
    drawer,
    stringField(value, 'type') ?? '',
    stringField(value, 'module') ?? '',
    normalize(stringField(value, 'summary') ?? raw),
    stringField(value, 'createdAt') ?? '',
  ]);
}

function bodyFor(value: Record<string, unknown>, raw: string): string | undefined {
  const body = [
    stringField(value, 'rationale'),
    stringField(value, 'cause'),
    stringField(value, 'solution'),
    Array.isArray(value.files) ? `files: ${value.files.join(', ')}` : undefined,
    Array.isArray(value.tags) ? `tags: ${value.tags.join(', ')}` : undefined,
  ].filter(Boolean).join('\n');
  return body || raw;
}

function openDatabase(root: string): Database.Database {
  const dbPath = getMemoryDbPath(root);
  fs.ensureDirSync(path.dirname(dbPath));
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  return db;
}

function openExistingDatabase(root: string): Database.Database | undefined {
  const dbPath = getMemoryDbPath(root);
  if (!fs.pathExistsSync(dbPath)) return undefined;
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}

export function migrateMemoryIndex(db: Database.Database): void {
  db.exec(`
    create table if not exists projects (
      id integer primary key,
      root_path text not null unique,
      name text not null,
      created_at text not null,
      updated_at text not null
    );

    create table if not exists modules (
      id integer primary key,
      project_id integer not null,
      name text not null,
      summary text,
      path text,
      created_at text not null,
      updated_at text not null,
      unique(project_id, name),
      foreign key(project_id) references projects(id)
    );

    create table if not exists memory_entries (
      id integer primary key,
      project_id integer not null,
      module_id integer,
      drawer text not null,
      type text not null,
      summary text not null,
      body text,
      status text,
      source text,
      confidence text,
      stable_key text not null unique,
      created_at text not null,
      updated_at text not null,
      last_seen_at text,
      superseded_by integer,
      foreign key(project_id) references projects(id),
      foreign key(module_id) references modules(id),
      foreign key(superseded_by) references memory_entries(id)
    );

    create table if not exists memory_links (
      id integer primary key,
      from_entry_id integer not null,
      to_entry_id integer not null,
      relation text not null,
      created_at text not null,
      foreign key(from_entry_id) references memory_entries(id),
      foreign key(to_entry_id) references memory_entries(id)
    );

    create table if not exists index_metadata (
      key text primary key,
      value text not null,
      updated_at text not null
    );

    create index if not exists idx_memory_entries_project_drawer on memory_entries(project_id, drawer);
    create index if not exists idx_memory_entries_module on memory_entries(module_id);
    create index if not exists idx_memory_entries_status on memory_entries(status);
  `);
  setMetadata(db, 'schema_version', schemaVersion);
}

function getMetadata(db: Database.Database, key: string): string | undefined {
  try {
    const row = db.prepare('select value from index_metadata where key = ?').get(key) as { value: string } | undefined;
    return row?.value;
  } catch {
    return undefined;
  }
}

function setMetadata(db: Database.Database, key: string, value: string): void {
  db.prepare(`
    insert into index_metadata (key, value, updated_at)
    values (?, ?, ?)
    on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value, now());
}

function ensureProject(db: Database.Database, root: string): number {
  const timestamp = now();
  const name = path.basename(root);
  db.prepare(`
    insert into projects (root_path, name, created_at, updated_at)
    values (?, ?, ?, ?)
    on conflict(root_path) do update set name = excluded.name, updated_at = excluded.updated_at
  `).run(root, name, timestamp, timestamp);
  return (db.prepare('select id from projects where root_path = ?').get(root) as ProjectRow).id;
}

function ensureModule(db: Database.Database, projectId: number, name: string, summary?: string): number {
  const timestamp = now();
  db.prepare(`
    insert into modules (project_id, name, summary, path, created_at, updated_at)
    values (?, ?, ?, null, ?, ?)
    on conflict(project_id, name) do update set
      summary = coalesce(excluded.summary, modules.summary),
      updated_at = excluded.updated_at
  `).run(projectId, name, summary, timestamp, timestamp);
  return (db.prepare('select id from modules where project_id = ? and name = ?').get(projectId, name) as ProjectRow).id;
}

async function fileSignature(filePath: string): Promise<string | undefined> {
  if (!(await fs.pathExists(filePath))) return undefined;
  const stat = await fs.stat(filePath);
  return JSON.stringify({ size: stat.size, mtimeMs: Math.round(stat.mtimeMs) });
}

export async function getMemoryIndexState(root: string): Promise<MemoryIndexState> {
  const dbPath = getMemoryDbPath(root);
  const exists = await fs.pathExists(dbPath);
  const trackedFiles = [];

  let db: Database.Database | undefined;
  try {
    if (exists) {
      db = openExistingDatabase(root);
    }

    for (const file of getMemoryFileNames()) {
      const filePath = getMemoryFilePath(root, file);
      const relative = path.relative(root, filePath);
      const signature = await fileSignature(filePath);
      const trackedSignature = db ? getMetadata(db, `source:${relative}`) : undefined;
      trackedFiles.push({ file: relative, exists: Boolean(signature), ...(signature ? { signature } : {}), ...(trackedSignature ? { trackedSignature } : {}) });
    }

    const stale = !exists || trackedFiles.some((file) => (file.signature ?? 'missing') !== file.trackedSignature);
    return {
      dbPath,
      exists,
      status: !exists ? 'missing' : stale ? 'stale' : 'in sync',
      ...(db ? { lastSyncAt: getMetadata(db, 'last_sync_at') } : {}),
      trackedFiles,
    };
  } finally {
    db?.close();
  }
}

function insertMemoryEntry(db: Database.Database, projectId: number, entry: MemoryEntry, value: Record<string, unknown>, seenAt: string): 'imported' | 'updated' {
  const drawer = entry.memoryFile;
  const summary = stringField(value, 'summary') ?? entry.raw;
  const moduleName = stringField(value, 'module');
  const moduleId = moduleName ? ensureModule(db, projectId, moduleName, drawer === 'modules' ? summary : undefined) : undefined;
  const key = stableKey(drawer, value, entry.raw);
  const existing = db.prepare('select id from memory_entries where stable_key = ?').get(key) as { id: number } | undefined;

  db.prepare(`
    insert into memory_entries (
      project_id, module_id, drawer, type, summary, body, status, source, confidence,
      stable_key, created_at, updated_at, last_seen_at, superseded_by
    )
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null)
    on conflict(stable_key) do update set
      project_id = excluded.project_id,
      module_id = excluded.module_id,
      drawer = excluded.drawer,
      type = excluded.type,
      summary = excluded.summary,
      body = excluded.body,
      status = excluded.status,
      source = excluded.source,
      confidence = excluded.confidence,
      updated_at = excluded.updated_at,
      last_seen_at = excluded.last_seen_at
  `).run(
    projectId,
    moduleId ?? null,
    drawer,
    stringField(value, 'type') ?? drawer,
    summary,
    bodyFor(value, entry.raw),
    stringField(value, 'status') ?? null,
    `${entry.file}:${entry.line}`,
    stringField(value, 'confidence') ?? null,
    key,
    stringField(value, 'createdAt') ?? seenAt,
    seenAt,
    seenAt,
  );

  return existing ? 'updated' : 'imported';
}

export async function syncMemoryIndex(root: string): Promise<MemoryIndexSyncResult> {
  const db = openDatabase(root);
  try {
    migrateMemoryIndex(db);
    const projectId = ensureProject(db, root);
    const entries = await readMemoryEntries(root);
    const invalidEntries = getInvalidMemoryEntries(entries);
    const invalidKeys = new Set(invalidEntries.map((entry) => `${entry.file}:${entry.line}`));
    const seenAt = now();
    let imported = 0;
    let updated = 0;

    const syncTransaction = db.transaction(() => {
      for (const entry of entries) {
        if (invalidKeys.has(`${entry.file}:${entry.line}`) || !isRecord(entry.value)) continue;
        const result = insertMemoryEntry(db, projectId, entry, entry.value, seenAt);
        if (result === 'imported') imported += 1;
        else updated += 1;
      }
    });
    syncTransaction();

    for (const file of getMemoryFileNames()) {
      const filePath = getMemoryFilePath(root, file);
      const relative = path.relative(root, filePath);
      setMetadata(db, `source:${relative}`, (await fileSignature(filePath)) ?? 'missing');
    }
    setMetadata(db, 'last_sync_at', seenAt);

    const entriesCount = (db.prepare('select count(*) as count from memory_entries where project_id = ?').get(projectId) as { count: number }).count;
    return {
      dbPath: getMemoryDbPath(root),
      projectId,
      imported,
      updated,
      skippedInvalid: invalidEntries.length,
      entries: entriesCount,
      warnings: invalidEntries.map((entry) => `skipped invalid memory entry ${entry.file}:${entry.line}`),
    };
  } finally {
    db.close();
  }
}

export async function ensureSyncedMemoryIndex(root: string): Promise<MemoryIndexSyncResult | undefined> {
  const state = await getMemoryIndexState(root);
  if (state.status === 'in sync') return undefined;
  return syncMemoryIndex(root);
}

function textScore(text: string, query: string): number {
  const normalizedText = normalize(text);
  const normalizedQuery = normalize(query);
  let score = 0;
  if (normalizedQuery && normalizedText.includes(normalizedQuery)) score += 30;
  for (const token of tokensFor(query)) {
    if (normalizedText.includes(token)) score += 4;
  }
  return score;
}

function statusScore(status: string | undefined): number {
  if (!status) return 0;
  const normalized = status.toLowerCase();
  if (activeStatuses.has(normalized)) return 8;
  if (inactiveStatuses.has(normalized)) return -8;
  return 1;
}

function recencyScore(createdAt: string): number {
  const time = Date.parse(createdAt);
  if (Number.isNaN(time)) return 0;
  const ageDays = Math.max(0, (Date.now() - time) / 86_400_000);
  if (ageDays <= 7) return 10;
  if (ageDays <= 30) return 7;
  if (ageDays <= 90) return 4;
  if (ageDays <= 365) return 2;
  return 1;
}

function scoreRow(row: IndexedMemoryEntry, query: string): number {
  const rank = rankingParts(row, query);
  return (rank.drawer * 10_000) + (rank.text * 100) + (rank.status * 10) + rank.recency;
}

function searchableText(row: IndexedMemoryEntry): string {
  return [row.summary, row.body, row.module, row.drawer, row.type, row.status].filter(Boolean).join(' ');
}

function rankingParts(row: IndexedMemoryEntry, query: string): { drawer: number; text: number; status: number; recency: number } {
  return {
    drawer: drawerPriority[row.drawer] ?? 0,
    text: textScore(searchableText(row), query),
    status: statusScore(row.status),
    recency: recencyScore(row.createdAt),
  };
}

function compareRankedEntries(a: IndexedMemoryEntry, b: IndexedMemoryEntry, query: string): number {
  const aRank = rankingParts(a, query);
  const bRank = rankingParts(b, query);
  return (
    bRank.drawer - aRank.drawer ||
    bRank.text - aRank.text ||
    bRank.status - aRank.status ||
    bRank.recency - aRank.recency ||
    b.createdAt.localeCompare(a.createdAt) ||
    a.summary.localeCompare(b.summary)
  );
}

function matchesQuery(row: IndexedMemoryEntry, query: string): boolean {
  return textScore(searchableText(row), query) > 0;
}

function rowToEntry(row: EntryRow): IndexedMemoryEntry {
  return {
    id: row.id,
    drawer: row.drawer,
    type: row.type,
    summary: row.summary,
    ...(row.body ? { body: row.body } : {}),
    ...(row.module ? { module: row.module } : {}),
    ...(row.status ? { status: row.status } : {}),
    ...(row.source ? { source: row.source } : {}),
    ...(row.confidence ? { confidence: row.confidence } : {}),
    stableKey: row.stable_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.last_seen_at ? { lastSeenAt: row.last_seen_at } : {}),
  };
}

export async function queryMemoryIndex(query: string, options: MemoryQueryOptions = {}): Promise<{ entries: IndexedMemoryEntry[]; warnings: string[]; sync?: MemoryIndexSyncResult }> {
  const root = options.cwd ?? process.cwd();
  const sync = await ensureSyncedMemoryIndex(root);
  const db = openDatabase(root);
  try {
    migrateMemoryIndex(db);
    const projectId = ensureProject(db, root);
    const rows = db.prepare(`
      select memory_entries.*, modules.name as module
      from memory_entries
      left join modules on modules.id = memory_entries.module_id
      where memory_entries.project_id = ?
    `).all(projectId) as EntryRow[];

    const entries = rows
      .map(rowToEntry)
      .filter((entry) => !options.module || entry.module === options.module)
      .filter((entry) => !options.drawer || entry.drawer === options.drawer)
      .filter((entry) => !options.type || entry.type === options.type)
      .filter((entry) => !options.status || entry.status === options.status)
      .filter((entry) => matchesQuery(entry, query))
      .map((entry) => ({ ...entry, score: scoreRow(entry, query) }))
      .sort((a, b) => compareRankedEntries(a, b, query))
      .slice(0, options.limit ?? 10);

    return { entries, warnings: sync?.warnings ?? [], ...(sync ? { sync } : {}) };
  } finally {
    db.close();
  }
}

export async function inspectMemoryIndex(root: string): Promise<MemoryIndexInspect> {
  const state = await getMemoryIndexState(root);
  const db = openExistingDatabase(root);
  const entries = await readMemoryEntries(root);

  if (!db) {
    return {
      dbPath: state.dbPath,
      exists: false,
      status: 'missing',
      projectCount: 0,
      moduleCount: 0,
      entryCounts: {},
      invalidEntries: getInvalidMemoryEntries(entries).length,
      trackedFiles: state.trackedFiles,
    };
  }

  try {
    const projectCount = countRows(db, 'projects');
    const moduleCount = countRows(db, 'modules');
    const rows = tableExists(db, 'memory_entries')
      ? db.prepare('select drawer, count(*) as count from memory_entries group by drawer').all() as Array<{ drawer: string; count: number }>
      : [];
    return {
      dbPath: state.dbPath,
      exists: state.exists,
      status: state.status,
      projectCount,
      moduleCount,
      entryCounts: Object.fromEntries(rows.map((row) => [row.drawer, row.count])),
      invalidEntries: getInvalidMemoryEntries(entries).length,
      lastSyncAt: getMetadata(db, 'last_sync_at'),
      trackedFiles: state.trackedFiles,
    };
  } finally {
    db.close();
  }
}

function tableExists(db: Database.Database, table: string): boolean {
  try {
    const row = db.prepare("select name from sqlite_master where type = 'table' and name = ?").get(table);
    return Boolean(row);
  } catch {
    return false;
  }
}

function countRows(db: Database.Database, table: string): number {
  if (!tableExists(db, table)) return 0;
  try {
    return (db.prepare(`select count(*) as count from ${table}`).get() as { count: number }).count;
  } catch {
    return 0;
  }
}

export async function rebuildMemoryIndex(root: string, options: { dryRun?: boolean } = {}): Promise<MemoryIndexSyncResult | { dbPath: string; dryRun: true }> {
  const dbPath = getMemoryDbPath(root);
  if (options.dryRun) return { dbPath, dryRun: true };
  await fs.remove(dbPath);
  await fs.remove(`${dbPath}-wal`);
  await fs.remove(`${dbPath}-shm`);
  return syncMemoryIndex(root);
}

export function validateMemoryIndexSchema(root: string): { ok: boolean; error?: string } {
  if (!fs.pathExistsSync(getMemoryDbPath(root))) return { ok: true };
  const db = openDatabase(root);
  try {
    migrateMemoryIndex(db);
    db.prepare('select id from projects limit 1').all();
    db.prepare('select id from memory_entries limit 1').all();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    db.close();
  }
}

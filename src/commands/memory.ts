import pc from 'picocolors';
import {
  inspectMemoryIndex,
  queryMemoryIndex,
  rebuildMemoryIndex,
  type IndexedMemoryEntry,
} from '../core/memory-index.js';
import {
  appendMemoryEntry,
  formatInvalidMemoryEntry,
  getInvalidMemoryEntries,
  getMemoryFiles,
  getMemoryFileNames,
  type MemoryFileName,
  type SearchMemoryOptions,
  readMemoryEntries,
  searchMemory,
} from '../core/jsonl-memory.js';
import fs from 'fs-extra';

const supportedMemoryFiles = getMemoryFileNames();

function isMemoryFileName(value: string): value is MemoryFileName {
  return supportedMemoryFiles.includes(value as MemoryFileName);
}

function parseList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const items = value.split(',').map((item) => item.trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function parseLimit(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const limit = typeof value === 'number' ? value : Number.parseInt(value, 10);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('--limit must be a positive integer.');
  }
  return limit;
}

function parseQueryOptions(options: {
  cwd?: string;
  module?: string;
  drawer?: string;
  type?: string;
  status?: string;
  limit?: string | number;
}): {
  cwd?: string;
  module?: string;
  drawer?: string;
  type?: string;
  status?: string;
  limit?: number;
} {
  return {
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.module ? { module: options.module } : {}),
    ...(options.drawer ? { drawer: options.drawer } : {}),
    ...(options.type ? { type: options.type } : {}),
    ...(options.status ? { status: options.status } : {}),
    ...(options.limit !== undefined ? { limit: parseLimit(options.limit) } : {}),
  };
}

function parseSearchOptions(options: { file?: string; type?: string; module?: string; limit?: string | number }): SearchMemoryOptions {
  const file = options.file;
  if (options.file && !isMemoryFileName(options.file)) {
    throw new Error(`--file must be one of: ${supportedMemoryFiles.join(', ')}`);
  }

  return {
    ...(file && isMemoryFileName(file) ? { file } : {}),
    ...(options.type ? { type: options.type } : {}),
    ...(options.module ? { module: options.module } : {}),
    ...(options.limit !== undefined ? { limit: parseLimit(options.limit) } : {}),
  };
}

export async function runMemoryList(options: { cwd?: string } = {}): Promise<void> {
  const root = options.cwd ?? process.cwd();
  const entries = await readMemoryEntries(root);

  console.log(pc.bold('agent-flow memory'));
  console.log(`Entries: ${entries.length}`);

  for (const file of getMemoryFiles(root)) {
    const exists = await fs.pathExists(file);
    console.log(`${exists ? pc.green('ok') : pc.yellow('missing')} ${file.replace(`${root}/`, '')}`);
  }

  for (const entry of entries.slice(-20)) {
    console.log(`${pc.dim(`${entry.file}:${entry.line}`)} ${entry.raw}`);
  }
}

export async function runMemorySearch(
  query: string,
  options: { cwd?: string; file?: string; type?: string; module?: string; limit?: string | number } = {},
): Promise<void> {
  const root = options.cwd ?? process.cwd();
  const matches = await searchMemory(root, query, parseSearchOptions(options));

  console.log(pc.bold(`agent-flow memory search: ${query}`));

  if (matches.length === 0) {
    console.log('No matches.');
    return;
  }

  for (const match of matches) {
    console.log(`${pc.dim(`${match.file}:${match.line}`)} ${match.raw}`);
  }
}

function formatQueryEntry(entry: IndexedMemoryEntry): string {
  const parts = [
    `#${entry.id}`,
    entry.drawer,
    entry.module ? `[${entry.module}]` : undefined,
    entry.type,
    entry.status ? `(${entry.status})` : undefined,
  ].filter(Boolean).join(' ');
  return `${pc.dim(parts)} ${entry.summary} ${pc.dim(entry.createdAt)}`;
}

export async function runMemoryQuery(
  query: string,
  options: {
    cwd?: string;
    module?: string;
    drawer?: string;
    type?: string;
    status?: string;
    limit?: string | number;
    json?: boolean;
  } = {},
): Promise<void> {
  const result = await queryMemoryIndex(query, parseQueryOptions(options));

  if (options.json) {
    console.log(JSON.stringify({
      query,
      items: result.entries,
      warnings: result.warnings,
    }, null, 2));
    return;
  }

  console.log(pc.bold(`agent-flow memory query: ${query}`));
  for (const warning of result.warnings) {
    console.log(`${pc.yellow('warning')} ${warning}`);
  }

  if (result.entries.length === 0) {
    console.log('No matches.');
    return;
  }

  for (const entry of result.entries) {
    console.log(formatQueryEntry(entry));
  }
}

export async function runMemoryInspect(options: { cwd?: string } = {}): Promise<void> {
  const root = options.cwd ?? process.cwd();
  const inspect = await inspectMemoryIndex(root);

  console.log(pc.bold('agent-flow memory inspect'));
  console.log(`DB path: ${inspect.dbPath}`);
  console.log(`DB exists: ${inspect.exists ? 'yes' : 'no'}`);
  console.log(`Index status: ${inspect.status}`);
  console.log(`Last sync: ${inspect.lastSyncAt ?? 'never'}`);
  console.log(`Projects: ${inspect.projectCount}`);
  console.log(`Modules: ${inspect.moduleCount}`);
  console.log('Entries by drawer:');
  for (const drawer of ['events', 'modules', 'decisions', 'errors', 'constraints', 'commands', 'files', 'open_questions']) {
    console.log(`  ${drawer}: ${inspect.entryCounts[drawer] ?? 0}`);
  }
  console.log(`Invalid JSONL entries: ${inspect.invalidEntries}`);
  console.log('Tracked JSONL files:');
  for (const file of inspect.trackedFiles) {
    console.log(`  ${file.file}: ${file.exists ? 'present' : 'missing'}`);
  }
  if (inspect.status === 'stale') {
    console.log(`Suggested command: ${pc.bold('agent-flow memory rebuild')}`);
  }
}

export async function runMemoryRebuild(options: { cwd?: string; dryRun?: boolean; json?: boolean } = {}): Promise<void> {
  const root = options.cwd ?? process.cwd();
  const result = await rebuildMemoryIndex(root, { dryRun: options.dryRun });

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(pc.bold('agent-flow memory rebuild'));
  if ('dryRun' in result) {
    console.log(`Would rebuild ${result.dbPath}`);
    return;
  }
  console.log(`DB path: ${result.dbPath}`);
  console.log(`Imported: ${result.imported}`);
  console.log(`Updated: ${result.updated}`);
  console.log(`Skipped invalid: ${result.skippedInvalid}`);
  console.log(`Indexed entries: ${result.entries}`);
  for (const warning of result.warnings) {
    console.log(`${pc.yellow('warning')} ${warning}`);
  }
}

function formatCompactEntry(entry: { file: string; line: number; value: unknown; raw: string }): string {
  if (typeof entry.value !== 'object' || entry.value === null || Array.isArray(entry.value)) {
    return `${pc.dim(`${entry.file}:${entry.line}`)} ${entry.raw}`;
  }

  const value = entry.value as Record<string, unknown>;
  const type = typeof value.type === 'string' ? value.type : 'unknown';
  const module = typeof value.module === 'string' ? ` [${value.module}]` : '';
  const summary = typeof value.summary === 'string' ? value.summary : entry.raw;
  return `${pc.dim(`${entry.file}:${entry.line}`)} ${type}${module}: ${summary}`;
}

async function printContextSection(root: string, label: string, file: MemoryFileName, query: string, limit: number): Promise<void> {
  const matches = (await searchMemory(root, query, { file })).slice(-limit).reverse();

  console.log(label);

  if (matches.length === 0) {
    console.log('  none');
    return;
  }

  for (const match of matches) {
    console.log(`  ${formatCompactEntry(match)}`);
  }
}

export async function runMemoryContext(query: string, options: { cwd?: string; limit?: string | number } = {}): Promise<void> {
  const root = options.cwd ?? process.cwd();
  const limit = parseLimit(options.limit) ?? 5;

  console.log(pc.bold(`agent-flow memory context: ${query}`));
  await printContextSection(root, 'Recent relevant events:', 'events', query, limit);
  await printContextSection(root, 'Matching modules:', 'modules', query, limit);
  await printContextSection(root, 'Matching decisions:', 'decisions', query, limit);
  await printContextSection(root, 'Matching errors:', 'errors', query, limit);
  console.log('Suggested next usage in Codex: read this context with AGENTS.md and .planning/STATE.md, then use $flow-resume or the narrowest matching flow skill.');
}

export async function runMemoryValidate(options: { cwd?: string } = {}): Promise<void> {
  const root = options.cwd ?? process.cwd();
  const entries = await readMemoryEntries(root);
  const invalidEntries = getInvalidMemoryEntries(entries);

  console.log(pc.bold('agent-flow memory validate'));

  if (invalidEntries.length === 0) {
    console.log(`${pc.green('ok')} memory entries valid`);
    return;
  }

  console.log(`${pc.red('fail')} ${invalidEntries.length} invalid memory entr${invalidEntries.length === 1 ? 'y' : 'ies'}`);

  for (const entry of invalidEntries) {
    for (const line of formatInvalidMemoryEntry(entry)) {
      console.log(line);
    }
  }

  console.log('Fix entries manually or re-add them with agent-flow memory append.');
  process.exitCode = 1;
}

export async function runMemoryAppend(
  options: {
    cwd?: string;
    file?: string;
    type?: string;
    summary?: string;
    module?: string;
    status?: string;
    rationale?: string;
    alternatives?: string;
    cause?: string;
    solution?: string;
    files?: string;
    tags?: string;
    allowDuplicate?: boolean;
  } = {},
): Promise<void> {
  const root = options.cwd ?? process.cwd();

  if (!options.file || !isMemoryFileName(options.file)) {
    throw new Error(`--file must be one of: ${supportedMemoryFiles.join(', ')}`);
  }

  if (!options.type) {
    throw new Error('--type is required.');
  }

  if (!options.summary) {
    throw new Error('--summary is required.');
  }

  const entry = await appendMemoryEntry(root, options.file, {
    type: options.type,
    summary: options.summary,
    ...(options.module ? { module: options.module } : {}),
    ...(options.status ? { status: options.status } : {}),
    ...(options.rationale ? { rationale: options.rationale } : {}),
    ...(parseList(options.alternatives) ? { alternatives: parseList(options.alternatives) } : {}),
    ...(options.cause ? { cause: options.cause } : {}),
    ...(options.solution ? { solution: options.solution } : {}),
    ...(parseList(options.files) ? { files: parseList(options.files) } : {}),
    ...(parseList(options.tags) ? { tags: parseList(options.tags) } : {}),
  }, { allowDuplicate: options.allowDuplicate });

  console.log(`${pc.green('appended')} ${entry.file}:${entry.line}`);
}

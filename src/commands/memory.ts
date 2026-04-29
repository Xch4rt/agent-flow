import pc from 'picocolors';
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

import pc from 'picocolors';
import {
  appendMemoryEntry,
  getMemoryFiles,
  type MemoryFileName,
  readMemoryEntries,
  searchMemory,
} from '../core/jsonl-memory.js';
import fs from 'fs-extra';

const supportedMemoryFiles = ['events', 'decisions', 'errors', 'modules'] as const;

function isMemoryFileName(value: string): value is MemoryFileName {
  return supportedMemoryFiles.includes(value as MemoryFileName);
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

export async function runMemorySearch(query: string, options: { cwd?: string } = {}): Promise<void> {
  const root = options.cwd ?? process.cwd();
  const matches = await searchMemory(root, query);

  console.log(pc.bold(`agent-flow memory search: ${query}`));

  if (matches.length === 0) {
    console.log('No matches.');
    return;
  }

  for (const match of matches) {
    console.log(`${pc.dim(`${match.file}:${match.line}`)} ${match.raw}`);
  }
}

export async function runMemoryAppend(
  options: { cwd?: string; file?: string; type?: string; summary?: string; module?: string } = {},
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
  });

  console.log(`${pc.green('appended')} ${entry.file}:${entry.line}`);
}

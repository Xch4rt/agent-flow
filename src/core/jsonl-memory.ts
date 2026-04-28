import path from 'node:path';
import fs from 'fs-extra';

export type MemoryFileName = 'events' | 'decisions' | 'errors' | 'modules';

export type MemoryEntry = {
  file: string;
  line: number;
  value: unknown;
  raw: string;
};

export type AppendMemoryEntry = {
  type: string;
  summary: string;
  createdAt?: string;
  module?: string;
  [key: string]: unknown;
};

const memoryFileMap: Record<MemoryFileName, string> = {
  events: 'events.jsonl',
  decisions: 'decisions.jsonl',
  errors: 'errors.jsonl',
  modules: 'modules.jsonl',
};

const memoryFiles = Object.values(memoryFileMap);

export function getMemoryFilePath(root: string, file: MemoryFileName): string {
  return path.join(root, '.memory', memoryFileMap[file]);
}

export function getMemoryFiles(root: string): string[] {
  return memoryFiles.map((file) => path.join(root, '.memory', file));
}

export async function appendMemoryEntry(root: string, file: MemoryFileName, entry: AppendMemoryEntry): Promise<MemoryEntry> {
  if (!entry.type.trim()) {
    throw new Error('Memory entry requires a non-empty type.');
  }

  if (!entry.summary.trim()) {
    throw new Error('Memory entry requires a non-empty summary.');
  }

  const filePath = getMemoryFilePath(root, file);
  const value = {
    ...entry,
    createdAt: entry.createdAt ?? new Date().toISOString(),
  };
  const raw = `${JSON.stringify(value)}\n`;

  await fs.ensureDir(path.dirname(filePath));
  await fs.appendFile(filePath, raw, 'utf8');

  const content = await fs.readFile(filePath, 'utf8');
  const line = content.split(/\r?\n/).filter((item) => item.trim()).length;

  return {
    file: path.relative(root, filePath),
    line,
    value,
    raw: raw.trimEnd(),
  };
}

export async function readMemoryEntries(root: string): Promise<MemoryEntry[]> {
  const entries: MemoryEntry[] = [];

  for (const filePath of getMemoryFiles(root)) {
    if (!(await fs.pathExists(filePath))) continue;

    const content = await fs.readFile(filePath, 'utf8');
    const lines = content.split(/\r?\n/);

    for (const [index, raw] of lines.entries()) {
      if (!raw.trim()) continue;

      try {
        entries.push({
          file: path.relative(root, filePath),
          line: index + 1,
          value: JSON.parse(raw),
          raw,
        });
      } catch {
        entries.push({
          file: path.relative(root, filePath),
          line: index + 1,
          value: { parseError: true },
          raw,
        });
      }
    }
  }

  return entries;
}

export async function searchMemory(root: string, query: string): Promise<MemoryEntry[]> {
  const normalizedQuery = query.toLowerCase();
  const entries = await readMemoryEntries(root);
  return entries.filter((entry) => entry.raw.toLowerCase().includes(normalizedQuery));
}

import path from 'node:path';
import fs from 'fs-extra';
import { validateMemoryValue, type MemorySchemaError } from './memory-schemas.js';

export type MemoryFileName = 'events' | 'decisions' | 'errors' | 'modules';

export type MemoryEntry = {
  file: string;
  memoryFile: MemoryFileName;
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

export type AppendMemoryOptions = {
  allowDuplicate?: boolean;
};

export type SearchMemoryOptions = {
  file?: MemoryFileName;
  type?: string;
  module?: string;
  limit?: number;
};

export type InvalidMemoryEntry = MemoryEntry & {
  errors: MemorySchemaError[];
  entrySummary?: string;
  rawPreview: string;
  suggestedFix?: string;
};

const memoryFileMap: Record<MemoryFileName, string> = {
  events: 'events.jsonl',
  decisions: 'decisions.jsonl',
  errors: 'errors.jsonl',
  modules: 'modules.jsonl',
};

const memoryFiles = Object.values(memoryFileMap);
const memoryFileNames = Object.keys(memoryFileMap) as MemoryFileName[];

function getMemoryFileNameFromPath(filePath: string): MemoryFileName {
  const fileName = path.basename(filePath);
  const match = memoryFileNames.find((name) => memoryFileMap[name] === fileName);
  if (!match) {
    throw new Error(`Unsupported memory file path: ${filePath}`);
  }
  return match;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeSummary(summary: string): string {
  return summary.trim().replace(/\s+/g, ' ').toLowerCase();
}

function duplicateKey(file: MemoryFileName, value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.type !== 'string' || typeof value.summary !== 'string') {
    return undefined;
  }

  const module = typeof value.module === 'string' ? value.module.trim().toLowerCase() : '';
  return [file, value.type.trim().toLowerCase(), module, normalizeSummary(value.summary)].join('\0');
}

function previewRaw(raw: string): string {
  const normalized = raw.trim().replace(/\s+/g, ' ');
  return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized;
}

function entrySummary(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  return typeof value.summary === 'string' ? value.summary : undefined;
}

function invalidMemoryEntry(entry: MemoryEntry, errors: MemorySchemaError[]): InvalidMemoryEntry {
  return {
    ...entry,
    errors,
    entrySummary: entrySummary(entry.value),
    rawPreview: previewRaw(entry.raw),
    suggestedFix: errors.find((error) => error.suggestion)?.suggestion,
  };
}

export function getMemoryFilePath(root: string, file: MemoryFileName): string {
  return path.join(root, '.memory', memoryFileMap[file]);
}

export function getMemoryFiles(root: string): string[] {
  return memoryFiles.map((file) => path.join(root, '.memory', file));
}

export function getMemoryFileNames(): MemoryFileName[] {
  return [...memoryFileNames];
}

export async function appendMemoryEntry(
  root: string,
  file: MemoryFileName,
  entry: AppendMemoryEntry,
  options: AppendMemoryOptions = {},
): Promise<MemoryEntry> {
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

  const validation = validateMemoryValue(file, value);
  if (!validation.ok) {
    const errors = validation.errors.map((error) => `${error.path}: ${error.message}`).join('; ');
    throw new Error(`Invalid ${file} memory entry: ${errors}`);
  }

  if (!options.allowDuplicate) {
    const nextKey = duplicateKey(file, value);
    const entries = await readMemoryEntries(root);
    const duplicate = entries.find((existing) => {
      return existing.memoryFile === file && duplicateKey(file, existing.value) === nextKey;
    });

    if (duplicate) {
      throw new Error(`Duplicate memory entry already exists at ${duplicate.file}:${duplicate.line}. Use --allow-duplicate to append anyway.`);
    }
  }

  const raw = `${JSON.stringify(value)}\n`;

  await fs.ensureDir(path.dirname(filePath));
  await fs.appendFile(filePath, raw, 'utf8');

  const content = await fs.readFile(filePath, 'utf8');
  const line = content.split(/\r?\n/).filter((item) => item.trim()).length;

  return {
    file: path.relative(root, filePath),
    memoryFile: file,
    line,
    value,
    raw: raw.trimEnd(),
  };
}

export async function readMemoryEntries(root: string): Promise<MemoryEntry[]> {
  const entries: MemoryEntry[] = [];

  for (const filePath of getMemoryFiles(root)) {
    if (!(await fs.pathExists(filePath))) continue;

    const memoryFile = getMemoryFileNameFromPath(filePath);
    const content = await fs.readFile(filePath, 'utf8');
    const lines = content.split(/\r?\n/);

    for (const [index, raw] of lines.entries()) {
      if (!raw.trim()) continue;

      try {
        entries.push({
          file: path.relative(root, filePath),
          memoryFile,
          line: index + 1,
          value: JSON.parse(raw),
          raw,
        });
      } catch {
        entries.push({
          file: path.relative(root, filePath),
          memoryFile,
          line: index + 1,
          value: { parseError: true },
          raw,
        });
      }
    }
  }

  return entries;
}

export function getInvalidMemoryEntries(entries: MemoryEntry[]): InvalidMemoryEntry[] {
  return entries.flatMap((entry) => {
    if (isRecord(entry.value) && entry.value.parseError === true) {
      return [
        invalidMemoryEntry(entry, [
          {
            path: 'entry',
            message: 'Invalid JSON',
            suggestion: 'Fix the JSON syntax on this line, or remove and re-add it with agent-flow memory append.',
          },
        ]),
      ];
    }

    const validation = validateMemoryValue(entry.memoryFile, entry.value);
    if (validation.ok) {
      return [];
    }

    return [invalidMemoryEntry(entry, validation.errors)];
  });
}

export function formatInvalidMemoryEntry(entry: InvalidMemoryEntry): string[] {
  const lines = [`${entry.file}:${entry.line}`];

  if (entry.entrySummary) {
    lines.push(`  summary: ${entry.entrySummary}`);
  } else if (entry.rawPreview) {
    lines.push(`  raw: ${entry.rawPreview}`);
  }

  for (const error of entry.errors) {
    lines.push(`  error ${error.path}: ${error.message}`);
    if (error.suggestion) {
      lines.push(`  fix: ${error.suggestion}`);
    }
  }

  return lines;
}

export async function searchMemory(root: string, query: string, options: SearchMemoryOptions = {}): Promise<MemoryEntry[]> {
  const normalizedQuery = query.toLowerCase();
  const entries = await readMemoryEntries(root);
  const matches = entries.filter((entry) => {
    if (options.file && entry.memoryFile !== options.file) return false;
    if (options.type && (!isRecord(entry.value) || entry.value.type !== options.type)) return false;
    if (options.module && (!isRecord(entry.value) || entry.value.module !== options.module)) return false;
    return entry.raw.toLowerCase().includes(normalizedQuery);
  });

  return typeof options.limit === 'number' ? matches.slice(0, options.limit) : matches;
}

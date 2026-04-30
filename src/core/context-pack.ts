import path from 'node:path';
import { execa } from 'execa';
import fs from 'fs-extra';
import { detectProject, type ProjectDetection } from './detect-project.js';
import { readMemoryEntries, type MemoryEntry, type MemoryFileName } from './jsonl-memory.js';
import { queryMemoryIndex, type IndexedMemoryEntry, type MemoryDrawer } from './memory-index.js';

export type ContextPackOptions = {
  cwd?: string;
  module?: string;
  limit?: number;
  budgetLines?: number;
  includeEvents?: boolean;
  includeOpenQuestions?: boolean;
};

export type ContextPackItem = {
  file: string;
  line?: number;
  type: string;
  module?: string;
  status?: string;
  summary: string;
  cause?: string;
  solution?: string;
};

type ScoredContextPackItem = ContextPackItem & {
  score: number;
};

export type ContextPackProject = {
  packageManager: ProjectDetection['packageManager'];
  stack: ProjectDetection['stacks'];
  commands: ProjectDetection['commands'];
};

export type ContextPackGit = {
  available: boolean;
  branch?: string;
  dirty?: boolean;
  lastCommit?: string;
};

export type ContextPack = {
  task: string;
  module?: string;
  project: ContextPackProject;
  git: ContextPackGit;
  state: string;
  items: {
    modules: ContextPackItem[];
    decisions: ContextPackItem[];
    errors: ContextPackItem[];
    events: ContextPackItem[];
    openQuestions: ContextPackItem[];
  };
  verificationCommands: string[];
  warnings: string[];
};

const memoryPriority: Record<MemoryFileName, number> = {
  decisions: 40,
  errors: 34,
  modules: 28,
  events: 12,
};

const activeStatuses = new Set(['accepted', 'active', 'current', 'approved', 'implemented']);
const inactiveStatuses = new Set(['superseded', 'deprecated', 'rejected', 'inactive', 'obsolete']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function tokensFor(value: string): string[] {
  return [...new Set(normalize(value).split(/\s+/).filter((token) => token.length > 1))];
}

function compact(value: string, maxLength = 220): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3).trimEnd()}...` : normalized;
}

function field(value: Record<string, unknown>, key: string): string | undefined {
  return typeof value[key] === 'string' ? value[key] : undefined;
}

function searchableText(entry: MemoryEntry): string {
  if (!isRecord(entry.value)) return entry.raw;
  return [
    field(entry.value, 'summary'),
    field(entry.value, 'module'),
    field(entry.value, 'type'),
    field(entry.value, 'status'),
    field(entry.value, 'cause'),
    field(entry.value, 'solution'),
    field(entry.value, 'rationale'),
    entry.raw,
  ].filter(Boolean).join(' ');
}

function recencyScore(value: unknown): number {
  if (!isRecord(value) || typeof value.createdAt !== 'string') return 0;
  const time = Date.parse(value.createdAt);
  if (Number.isNaN(time)) return 0;
  const ageDays = Math.max(0, (Date.now() - time) / 86_400_000);
  if (ageDays <= 7) return 10;
  if (ageDays <= 30) return 7;
  if (ageDays <= 90) return 4;
  if (ageDays <= 365) return 2;
  return 1;
}

function statusScore(value: unknown): number {
  if (!isRecord(value) || typeof value.status !== 'string') return 0;
  const status = value.status.toLowerCase();
  if (activeStatuses.has(status)) return 8;
  if (inactiveStatuses.has(status)) return -8;
  return 1;
}

function exactTaskMatch(text: string, task: string): boolean {
  const normalizedText = normalize(text);
  const normalizedTask = normalize(task);
  return Boolean(normalizedTask && normalizedText === normalizedTask);
}

function textScore(text: string, task: string): number {
  const normalizedText = normalize(text);
  const normalizedTask = normalize(task);
  const taskTokens = tokensFor(task);
  let score = 0;

  if (normalizedTask && normalizedText.includes(normalizedTask)) {
    score += 30;
  }

  for (const token of taskTokens) {
    if (normalizedText.includes(token)) {
      score += 4;
    }
  }

  return score;
}

function scoreMemoryEntry(entry: MemoryEntry, task: string, module: string | undefined): number {
  const value = isRecord(entry.value) ? entry.value : {};
  const entryModule = field(value, 'module');
  let score = memoryPriority[entry.memoryFile] + textScore(searchableText(entry), task) + recencyScore(entry.value);

  if (entry.memoryFile === 'decisions') {
    score += statusScore(entry.value);
  }

  if (module) {
    if (entryModule?.toLowerCase() === module.toLowerCase()) {
      score += 24;
    } else {
      score -= 18;
    }
  }

  return score;
}

function memoryEntryMatches(entry: MemoryEntry, task: string, module: string | undefined): boolean {
  const value = isRecord(entry.value) ? entry.value : {};
  const entryModule = field(value, 'module');

  if (module) {
    return entryModule?.toLowerCase() === module.toLowerCase();
  }

  return textScore(searchableText(entry), task) > 0;
}

function memoryItem(entry: MemoryEntry, score: number): ScoredContextPackItem {
  const value = isRecord(entry.value) ? entry.value : {};
  return {
    file: entry.file,
    line: entry.line,
    type: field(value, 'type') ?? entry.memoryFile,
    ...(field(value, 'module') ? { module: field(value, 'module') } : {}),
    ...(field(value, 'status') ? { status: field(value, 'status') } : {}),
    summary: compact(field(value, 'summary') ?? entry.raw),
    ...(field(value, 'cause') ? { cause: compact(field(value, 'cause') ?? '') } : {}),
    ...(field(value, 'solution') ? { solution: compact(field(value, 'solution') ?? '') } : {}),
    score,
  };
}

function indexedItem(entry: IndexedMemoryEntry): ScoredContextPackItem {
  return {
    file: entry.source ?? '.agent-flow/memory.db',
    type: entry.type,
    ...(entry.module ? { module: entry.module } : {}),
    ...(entry.status ? { status: entry.status } : {}),
    summary: compact(entry.summary),
    ...(entry.drawer === 'errors' && entry.body ? parseErrorBody(entry.body) : {}),
    score: entry.score ?? 0,
  };
}

function parseErrorBody(body: string): { cause?: string; solution?: string } {
  const cause = body.split(/\r?\n/).find((line) => line && !line.startsWith('files:') && !line.startsWith('tags:'));
  const solution = body.split(/\r?\n/).find((line) => line && line !== cause && !line.startsWith('files:') && !line.startsWith('tags:'));
  return {
    ...(cause ? { cause: compact(cause) } : {}),
    ...(solution ? { solution: compact(solution) } : {}),
  };
}

function stripScore(item: ScoredContextPackItem): ContextPackItem {
  const { score: _score, ...rest } = item;
  return rest;
}

async function readOptional(root: string, relativePath: string): Promise<string> {
  const filePath = path.join(root, relativePath);
  if (!(await fs.pathExists(filePath))) return '';
  return fs.readFile(filePath, 'utf8');
}

function markdownSection(content: string, heading: string): string {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${heading.toLowerCase()}`);
  if (start === -1) return '';
  const body: string[] = [];

  for (const line of lines.slice(start + 1)) {
    if (/^##\s+/.test(line)) break;
    if (line.trim()) body.push(line.trim());
  }

  return compact(body.join(' '), 500);
}

function planningSummary(content: string): string {
  return markdownSection(content, 'Current Status') || compact(content.replace(/^#\s+State\s*/i, ''), 500);
}

function planningListItems(
  content: string,
  file: string,
  type: string,
  task: string,
  module: string | undefined,
  limit: number,
): ScoredContextPackItem[] {
  const lines = content.split(/\r?\n/)
    .map((line, index) => ({ line: index + 1, text: line.replace(/^[-*]\s*/, '').trim() }))
    .filter((line) => line.text && !line.text.startsWith('#'));

  return lines
    .map((line) => {
      const moduleScore = module && normalize(line.text).includes(normalize(module)) ? 16 : 0;
      return {
        file,
        line: line.line,
        type,
        summary: compact(line.text),
        score: textScore(line.text, task) + moduleScore,
      };
    })
    .filter((item) => item.score > 0 || !task.trim())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function topItems(entries: MemoryEntry[], file: MemoryFileName, task: string, module: string | undefined, limit: number): ContextPackItem[] {
  return topScoredItems(entries, file, task, module, limit).map(stripScore);
}

function topScoredItems(entries: MemoryEntry[], file: MemoryFileName, task: string, module: string | undefined, limit: number): ScoredContextPackItem[] {
  return entries
    .filter((entry) => entry.memoryFile === file)
    .filter((entry) => memoryEntryMatches(entry, task, module))
    .map((entry) => ({ entry, score: scoreMemoryEntry(entry, task, module) }))
    .sort((a, b) => b.score - a.score || a.entry.line - b.entry.line)
    .slice(0, limit)
    .map(({ entry, score }) => memoryItem(entry, score));
}

async function indexedItems(root: string, task: string, drawer: MemoryDrawer, module: string | undefined, limit: number): Promise<{ items: ScoredContextPackItem[]; warnings: string[] }> {
  const result = await queryMemoryIndex(task, { cwd: root, drawer, module, limit });
  return {
    items: result.entries.map(indexedItem),
    warnings: result.warnings,
  };
}

function filterInactiveDecisions(items: ScoredContextPackItem[], task: string, limit: number): ScoredContextPackItem[] {
  const activeOrUnknown = items.filter((item) => !item.status || !inactiveStatuses.has(item.status.toLowerCase()));
  const inactiveExact = items.filter((item) => {
    return item.status && inactiveStatuses.has(item.status.toLowerCase()) && exactTaskMatch(item.summary, task);
  });

  if (activeOrUnknown.length > 0) {
    return [...activeOrUnknown, ...inactiveExact]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  return items.sort((a, b) => b.score - a.score).slice(0, limit);
}

function verificationCommands(commands: Awaited<ReturnType<typeof detectProject>>['commands']): string[] {
  const detected = [commands.test, commands.lint, commands.typecheck, commands.build].filter((command): command is string => Boolean(command));
  return detected.length > 0 ? detected : ['Inspect package scripts and project docs before choosing checks.'];
}

function projectSummary(detection: ProjectDetection): ContextPackProject {
  return {
    packageManager: detection.packageManager,
    stack: detection.stacks,
    commands: detection.commands,
  };
}

async function runGit(root: string, args: string[]): Promise<string | undefined> {
  try {
    const result = await execa('git', args, { cwd: root });
    return result.stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function detectGitContext(root: string): Promise<ContextPackGit> {
  const inside = await runGit(root, ['rev-parse', '--is-inside-work-tree']);
  if (inside !== 'true') {
    return { available: false };
  }

  const [branch, status, lastCommit] = await Promise.all([
    runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
    runGit(root, ['status', '--short']),
    runGit(root, ['log', '-1', '--pretty=format:%h %s']),
  ]);

  return {
    available: true,
    ...(branch ? { branch } : {}),
    dirty: Boolean(status),
    ...(lastCommit ? { lastCommit } : {}),
  };
}

export async function buildContextPack(task: string, options: ContextPackOptions = {}): Promise<ContextPack> {
  const root = options.cwd ?? process.cwd();
  const limit = options.limit ?? 5;
  const module = options.module;
  const warnings: string[] = [];
  const [detection, git, entries, stateMd, projectMd, decisionsMd, openQuestionsMd] = await Promise.all([
    detectProject(root),
    detectGitContext(root),
    readMemoryEntries(root),
    readOptional(root, '.planning/STATE.md'),
    readOptional(root, '.planning/PROJECT.md'),
    readOptional(root, '.planning/DECISIONS.md'),
    readOptional(root, '.planning/OPEN_QUESTIONS.md'),
  ]);

  if (!stateMd.trim()) warnings.push('missing .planning/STATE.md');
  if (entries.length === 0) warnings.push('not enough memory entries for a rich context pack');

  let indexedMemory: {
    modules: ScoredContextPackItem[];
    decisions: ScoredContextPackItem[];
    errors: ScoredContextPackItem[];
    events: ScoredContextPackItem[];
  } | undefined;

  try {
    const [indexedModules, indexedDecisions, indexedErrors, indexedEvents] = await Promise.all([
      indexedItems(root, task, 'modules', module, limit),
      indexedItems(root, task, 'decisions', module, limit),
      indexedItems(root, task, 'errors', module, limit),
      indexedItems(root, task, 'events', module, limit),
    ]);
    indexedMemory = {
      modules: indexedModules.items,
      decisions: indexedDecisions.items,
      errors: indexedErrors.items,
      events: indexedEvents.items,
    };
    for (const warning of [...indexedModules.warnings, ...indexedDecisions.warnings, ...indexedErrors.warnings, ...indexedEvents.warnings]) {
      if (!warnings.includes(warning)) warnings.push(warning);
    }
  } catch (error) {
    warnings.push(`memory index unavailable; used JSONL fallback (${error instanceof Error ? error.message : String(error)})`);
  }

  const decisionItems = filterInactiveDecisions([
    ...(indexedMemory?.decisions ?? topScoredItems(entries, 'decisions', task, module, limit)),
    ...planningListItems(decisionsMd, '.planning/DECISIONS.md', 'decision', task, module, limit),
  ].sort((a, b) => b.score - a.score), task, limit).map(stripScore);

  const items = {
    modules: (indexedMemory?.modules ?? topScoredItems(entries, 'modules', task, module, limit)).slice(0, limit).map(stripScore),
    decisions: decisionItems,
    errors: (indexedMemory?.errors ?? topScoredItems(entries, 'errors', task, module, limit)).slice(0, limit).map(stripScore),
    events: options.includeEvents === false ? [] : (indexedMemory?.events ?? topScoredItems(entries, 'events', task, module, limit)).slice(0, limit).map(stripScore),
    openQuestions: options.includeOpenQuestions === false
      ? []
      : planningListItems(openQuestionsMd, '.planning/OPEN_QUESTIONS.md', 'open-question', task, module, limit).map(stripScore),
  };

  if (items.modules.length + items.decisions.length + items.errors.length + items.events.length === 0) {
    warnings.push('no relevant memory entries matched the task');
  }

  return {
    task,
    ...(module ? { module } : {}),
    project: projectSummary(detection),
    git,
    state: planningSummary(stateMd) || markdownSection(projectMd, 'Purpose') || 'No current state summary found.',
    items,
    verificationCommands: verificationCommands(detection.commands),
    warnings,
  };
}

function lineCount(lines: string[]): number {
  return lines.length;
}

function pushSection(lines: string[], title: string, items: ContextPackItem[], formatter: (item: ContextPackItem) => string[]): void {
  lines.push('');
  lines.push(`${title}:`);
  if (items.length === 0) {
    lines.push('- none relevant found');
    return;
  }
  for (const item of items) {
    lines.push(...formatter(item));
  }
}

function basicItem(prefix: string): (item: ContextPackItem) => string[] {
  return (item) => [`- [${item.module ?? item.status ?? item.type ?? prefix}] ${item.summary}`];
}

function errorItem(item: ContextPackItem): string[] {
  const lines = [`- [${item.module ?? item.type}] ${item.summary}`];
  if (item.cause) lines.push(`  cause: ${item.cause}`);
  if (item.solution) lines.push(`  solution: ${item.solution}`);
  return lines;
}

function projectCommandSummary(commands: ContextPackProject['commands']): string {
  const commandLines = [
    commands.dev && `dev=${commands.dev}`,
    commands.build && `build=${commands.build}`,
    commands.test && `test=${commands.test}`,
    commands.lint && `lint=${commands.lint}`,
    commands.typecheck && `typecheck=${commands.typecheck}`,
  ].filter(Boolean);

  return commandLines.length ? commandLines.join(', ') : 'none detected';
}

function pushProjectAndGit(lines: string[], pack: ContextPack): void {
  lines.push('');
  lines.push('Project Summary:');
  lines.push(`- Package manager: ${pack.project.packageManager}`);
  lines.push(`- Stack: ${pack.project.stack.length ? pack.project.stack.join(', ') : 'none'}`);
  lines.push(`- Commands: ${projectCommandSummary(pack.project.commands)}`);

  lines.push('');
  lines.push('Git Context:');
  if (!pack.git.available) {
    lines.push('- Git: not detected');
  } else {
    lines.push(`- Branch: ${pack.git.branch ?? 'unknown'}`);
    lines.push(`- Dirty: ${pack.git.dirty ? 'yes' : 'no'}`);
    lines.push(`- Last commit: ${pack.git.lastCommit ?? 'none'}`);
  }
}

function candidateLines(pack: ContextPack, sectionItems: ContextPack['items']): string[] {
  const lines = [
    '# Context Pack',
    '',
    'Task:',
    pack.task,
  ];

  pushProjectAndGit(lines, pack);

  lines.push('');
  lines.push('Current State:');
  lines.push(`- ${pack.state}`);

  pushSection(lines, 'Relevant Modules', sectionItems.modules, basicItem('module'));
  pushSection(lines, 'Relevant Decisions', sectionItems.decisions, (item) => [`- [${item.status ?? item.type}] ${item.summary}`]);
  pushSection(lines, 'Relevant Errors', sectionItems.errors, errorItem);
  pushSection(lines, 'Recent Relevant Events', sectionItems.events, basicItem('event'));
  pushSection(lines, 'Open Questions', sectionItems.openQuestions, basicItem('question'));

  lines.push('');
  lines.push('Verification Commands:');
  for (const command of pack.verificationCommands) {
    lines.push(`- ${command}`);
  }

  if (pack.warnings.length > 0) {
    lines.push('');
    lines.push('Warnings:');
    for (const warning of pack.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  lines.push('');
  lines.push('Suggested Agent Usage:');
  lines.push('- Use this context before running $flow-quick or $flow-plan.');
  lines.push('- Treat it as a starting point; inspect referenced files before editing.');

  return lines;
}

function requiredLines(pack: ContextPack): string[] {
  const lines = [
    '# Context Pack',
    '',
    'Task:',
    pack.task,
  ];

  pushProjectAndGit(lines, pack);

  lines.push('');
  lines.push('Current State:');
  lines.push(`- ${pack.state}`);

  lines.push('');
  lines.push('Verification Commands:');
  for (const command of pack.verificationCommands) {
    lines.push(`- ${command}`);
  }

  if (pack.warnings.length > 0) {
    lines.push('');
    lines.push('Warnings:');
    for (const warning of pack.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  lines.push('');
  lines.push('Suggested Agent Usage:');
  lines.push('- Use this context before running $flow-quick or $flow-plan.');
  lines.push('- Treat it as a starting point; inspect referenced files before editing.');

  return lines;
}

function trimItemsForBudget(pack: ContextPack, budgetLines: number): ContextPack['items'] {
  const items = {
    modules: [...pack.items.modules],
    decisions: [...pack.items.decisions],
    errors: [...pack.items.errors],
    events: [...pack.items.events],
    openQuestions: [...pack.items.openQuestions],
  };
  const trimOrder: Array<keyof ContextPack['items']> = ['events', 'openQuestions', 'modules', 'decisions', 'errors'];

  while (lineCount(candidateLines(pack, items)) > budgetLines) {
    const section = trimOrder.find((key) => items[key].length > 0);
    if (!section) break;
    items[section].pop();
  }

  return items;
}

export function formatContextPack(pack: ContextPack, options: { budgetLines?: number } = {}): string {
  const budgetLines = options.budgetLines ?? 100;
  const items = trimItemsForBudget(pack, budgetLines);
  let lines = candidateLines(pack, items);

  if (lines.length > budgetLines) {
    lines = requiredLines(pack);
  }

  if (lines.length > budgetLines) {
    lines = lines.filter((line) => line !== '- Treat it as a starting point; inspect referenced files before editing.');
  }

  return `${lines.join('\n')}\n`;
}

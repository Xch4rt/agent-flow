import path from 'node:path';
import pc from 'picocolors';
import { detectProject } from '../core/detect-project.js';
import { writeFileSafe, type WriteResult } from '../core/write-file-safe.js';
import {
  agentsTemplate,
  configTemplate,
  decisionsTemplate,
  openQuestionsTemplate,
  projectTemplate,
  requirementsTemplate,
  roadmapTemplate,
  stateTemplate,
} from '../core/templates.js';
import { printFirstRunAgent, section, statusLabel } from '../core/terminal-ui.js';
import { installCodex } from '../adapters/codex/install-codex.js';

export type InitOptions = {
  codex?: boolean;
  force?: boolean;
  forceMemory?: boolean;
  cwd?: string;
};

function baseFiles(root: string, detection: Awaited<ReturnType<typeof detectProject>>): Array<{ path: string; content: string }> {
  return [
    { path: path.join(root, 'AGENTS.md'), content: agentsTemplate(detection) },
    { path: path.join(root, '.agent-flow', 'config.json'), content: configTemplate(detection) },
    { path: path.join(root, '.planning', 'PROJECT.md'), content: projectTemplate(detection) },
    { path: path.join(root, '.planning', 'REQUIREMENTS.md'), content: requirementsTemplate() },
    { path: path.join(root, '.planning', 'ROADMAP.md'), content: roadmapTemplate() },
    { path: path.join(root, '.planning', 'STATE.md'), content: stateTemplate(detection) },
    { path: path.join(root, '.planning', 'DECISIONS.md'), content: decisionsTemplate() },
    { path: path.join(root, '.planning', 'OPEN_QUESTIONS.md'), content: openQuestionsTemplate() },
  ];
}

function memoryFiles(root: string): Array<{ path: string; content: string }> {
  return [
    { path: path.join(root, '.memory', 'events.jsonl'), content: '' },
    { path: path.join(root, '.memory', 'decisions.jsonl'), content: '' },
    { path: path.join(root, '.memory', 'errors.jsonl'), content: '' },
    { path: path.join(root, '.memory', 'modules.jsonl'), content: '' },
  ];
}

function printResults(root: string, results: WriteResult[]): void {
  const grouped = {
    created: results.filter((result) => result.status === 'created'),
    overwritten: results.filter((result) => result.status === 'overwritten'),
    skipped: results.filter((result) => result.status === 'skipped'),
  };

  for (const status of ['created', 'overwritten', 'skipped'] as const) {
    for (const result of grouped[status]) {
      const relativePath = path.relative(root, result.path);
      console.log(`${statusLabel(status)} ${relativePath}`);
    }
  }
}

export async function runInit(options: InitOptions): Promise<void> {
  const root = options.cwd ?? process.cwd();
  const detection = await detectProject(root);
  const results: WriteResult[] = [];

  for (const file of baseFiles(root, detection)) {
    results.push(await writeFileSafe(file.path, file.content, { force: options.force }));
  }

  for (const file of memoryFiles(root)) {
    results.push(await writeFileSafe(file.path, file.content, { force: options.forceMemory }));
  }

  if (options.codex) {
    results.push(...(await installCodex(root, detection, { force: options.force })));
  }

  if (results.some((result) => result.status === 'created' && path.relative(root, result.path) === '.agent-flow/config.json')) {
    printFirstRunAgent();
    console.log(section('Initialized agent-flow'));
  }

  printResults(root, results);

  const skipped = results.filter((result) => result.status === 'skipped').length;
  if (skipped > 0 && !options.force) {
    console.log(pc.yellow(`Skipped ${skipped} existing file(s). Re-run with --force to overwrite.`));
  } else if (skipped > 0 && options.force && !options.forceMemory) {
    console.log(pc.yellow(`Skipped ${skipped} existing memory file(s). Re-run with --force-memory to overwrite memory.`));
  }
}

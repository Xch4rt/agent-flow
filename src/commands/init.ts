import fs from 'fs-extra';
import path from 'node:path';
import pc from 'picocolors';
import { detectProject } from '../core/detect-project.js';
import { ensureGitignore } from '../core/claude-settings.js';
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
import { getAdapter, type AgentId } from '../adapters/registry.js';
import { detectInstalledRuntimes } from '../core/detect-runtimes.js';

export type InitOptions = {
  codex?: boolean;
  claude?: boolean;
  /** codex | claude | all | none (none = base files only). */
  agent?: string;
  force?: boolean;
  forceMemory?: boolean;
  cwd?: string;
  /**
   * With no adapter flag: ask in a terminal (default when stdin/stdout are a TTY
   * and CI is unset), or pick what is installed on this machine. `false` never asks.
   */
  interactive?: boolean;
  /** Test seam / custom UI: answers the setup question with "1".."4". */
  ask?: (question: string) => Promise<string>;
};

function baseFiles(root: string, detection: Awaited<ReturnType<typeof detectProject>>): Array<{ path: string; content: string }> {
  return [
    { path: path.join(root, 'AGENTS.md'), content: agentsTemplate(detection) },
    { path: path.join(root, '.agent-flow', 'config.json'), content: configTemplate(detection, []) },
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
    appended: results.filter((result) => result.status === 'appended'),
    skipped: results.filter((result) => result.status === 'skipped'),
  };

  for (const status of ['created', 'overwritten', 'appended', 'skipped'] as const) {
    for (const result of grouped[status]) {
      const relativePath = path.relative(root, result.path);
      console.log(`${statusLabel(status)} ${relativePath}`);
    }
  }
}

/** Adapters named explicitly by flags; null when no flag said anything (so init may ask or detect). */
export function resolveAdapters(options: InitOptions): AgentId[] | null {
  const ids: AgentId[] = [];
  let explicit = false;

  if (options.agent) {
    explicit = true;
    const value = options.agent.toLowerCase();
    if (value === 'all') {
      ids.push('codex', 'claude');
    } else if (value === 'codex' || value === 'claude') {
      ids.push(value);
    } else if (value !== 'none') {
      throw new Error(`Unknown agent: ${options.agent}. Allowed values: codex, claude, all, none`);
    }
  }

  if (options.codex && !ids.includes('codex')) { ids.push('codex'); explicit = true; }
  if (options.claude && !ids.includes('claude')) { ids.push('claude'); explicit = true; }

  return explicit ? ids : null;
}

const CHOICES: Record<string, AgentId[]> = { '1': ['codex'], '2': ['claude'], '3': ['codex', 'claude'], '4': [] };

function choiceFor(detected: AgentId[]): string {
  if (detected.length === 2) return '3';
  if (detected[0] === 'codex') return '1';
  if (detected[0] === 'claude') return '2';
  return '4';
}

function describe(ids: AgentId[]): string {
  return ids.length === 0 ? 'base files only' : ids.map((id) => (id === 'codex' ? 'Codex' : 'Claude Code')).join(' + ');
}

async function askInTerminal(question: string): Promise<string> {
  const readline = await import('node:readline/promises');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

/**
 * Which adapters to install when no flag says: ask (interactive) with the
 * detected runtimes as the default answer, or just take the detected ones.
 */
export async function chooseAdapters(options: InitOptions = {}): Promise<AgentId[]> {
  const detected = await detectInstalledRuntimes();
  const suggested = choiceFor(detected);
  const interactive = options.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY && !process.env.CI);

  if (!interactive) {
    console.log(`${statusLabel('ok')} detected on this machine: ${describe(detected)} → installing ${describe(CHOICES[suggested])} ${pc.dim('(pass --codex, --claude, --agent all or --agent none to choose)')}`);
    return CHOICES[suggested];
  }

  console.log('Which agent setup do you want?');
  console.log(`  1. ${pc.cyan('Codex')}        ${pc.dim('skills in .agents/skills, roles in .codex/agents, hooks in .codex/hooks.json')}`);
  console.log(`  2. ${pc.cyan('Claude Code')}  ${pc.dim('skills and agents in .claude, CLAUDE.md, guard hook in .claude/settings.json')}`);
  console.log(`  3. ${pc.cyan('Both')}`);
  console.log(`  4. ${pc.dim('Base files only')}`);
  if (detected.length > 0) console.log(pc.dim(`Detected on this machine: ${describe(detected)}.`));
  console.log('');
  const ask = options.ask ?? askInTerminal;
  const answer = (await ask(`${pc.cyan('?')} Choice (1-4) [${suggested}]: `)).trim() || suggested;
  const chosen = CHOICES[answer];
  if (!chosen) throw new Error(`Invalid choice: ${answer}. Pick 1, 2, 3 or 4.`);
  return chosen;
}

export async function runInit(options: InitOptions): Promise<void> {
  const root = options.cwd ?? process.cwd();
  const detection = await detectProject(root);
  const adapterIds = resolveAdapters(options) ?? (await chooseAdapters(options));
  const results: WriteResult[] = [];

  const base = baseFiles(root, detection);
  const configIndex = base.findIndex((f) => f.path.endsWith('config.json'));
  if (configIndex >= 0) {
    base[configIndex] = {
      path: base[configIndex].path,
      content: configTemplate(detection, adapterIds),
    };
  }

  for (const file of base) {
    results.push(await writeFileSafe(file.path, file.content, { force: options.force }));
  }

  for (const file of memoryFiles(root)) {
    results.push(await writeFileSafe(file.path, file.content, { force: options.forceMemory }));
  }

  for (const id of adapterIds) {
    const adapter = getAdapter(id);
    results.push(...(await adapter.install(root, detection, { force: options.force })));
  }

  // Keep agent-flow's generated scratch (logs, handoffs, review prompts, caches) out of commits.
  if (await fs.pathExists(path.join(root, '.git'))) {
    results.push(await ensureGitignore(root));
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

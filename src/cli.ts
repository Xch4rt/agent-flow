#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import pc from 'picocolors';
import { fileURLToPath } from 'node:url';
import { runClose } from './commands/close.js';
import { runContext } from './commands/context.js';
import { runDoctor } from './commands/doctor.js';
import { runInit } from './commands/init.js';
import {
  runMemoryAppend,
  runMemoryContext,
  runMemoryInspect,
  runMemoryList,
  runMemoryQuery,
  runMemoryRebuild,
  runMemorySearch,
  runMemoryValidate,
} from './commands/memory.js';
import { runOnboard } from './commands/onboard.js';
import { runAdvance, runGateCommand, runNext } from './commands/orchestrate.js';
import { runPlanInit, runPlanShow, runPlanValidate } from './commands/plan.js';
import { runStart } from './commands/start.js';
import { runStatus } from './commands/status.js';
import { brandTitle } from './core/terminal-ui.js';
import { runDashboard } from './dashboard/dashboard.js';

function readPackageVersion(): string {
  const packageJsonPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { version?: unknown };

  return typeof packageJson.version === 'string' ? packageJson.version : '0.0.0';
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name('agent-flow')
    .description('Local workflow and memory layer for AI coding agents.')
    .version(readPackageVersion())
    .addHelpText('beforeAll', () => `${brandTitle('agent-flow')}\n`);

  program
    .command('init')
    .description('Initialize agent-flow planning, memory, and optional agent skill files.')
    .option('--codex', 'Install Codex skill workflows')
    .option('--claude', 'Install Claude Code skill workflows and CLAUDE.md')
    .option('--agent <agent>', 'Install agent adapter: codex, claude, or all')
    .option('--force', 'Overwrite existing generated files')
    .option('--force-memory', 'Overwrite existing memory JSONL files')
    .action(async (options: { codex?: boolean; claude?: boolean; agent?: string; force?: boolean; forceMemory?: boolean }) => {
      await runInit(options);
    });

  program
    .command('onboard')
    .description('Inspect the repository and write deterministic baseline project context.')
    .option('--refresh', 'Refresh generated onboarding sections and append a new onboarding memory event')
    .option('--dry-run', 'Print what would change without modifying files')
    .option('--force', 'Replace generated onboarding sections only, preserving custom content and memory')
    .action(async (options: { refresh?: boolean; dryRun?: boolean; force?: boolean }) => {
      await runOnboard(options);
    });

  program
    .command('status')
    .description('Show agent-flow project state.')
    .action(async () => {
      await runStatus();
    });

  program
    .command('doctor')
    .description('Check whether agent-flow files and local tools are present.')
    .action(async () => {
      await runDoctor();
    });

  program
    .command('context')
    .argument('<task>', 'Task to build a compact project-aware context pack for')
    .description('Build a deterministic project-aware context pack for agent work.')
    .option('--module <module>', 'Prefer memory and questions for one module or area')
    .option('--limit <number>', 'Maximum relevant items per section')
    .option('--budget-lines <number>', 'Approximate maximum output lines')
    .option('--json', 'Print structured JSON')
    .option('--include-events', 'Include recent relevant events (default-on compatibility flag)')
    .option('--include-open-questions', 'Include relevant open questions (default-on compatibility flag)')
    .option('--stats', 'Print estimated token savings')
    .option('--no-color', 'Disable colored output')
    .action(async (task: string, options: {
      module?: string;
      limit?: string;
      budgetLines?: string;
      json?: boolean;
      stats?: boolean;
      includeEvents?: boolean;
      includeOpenQuestions?: boolean;
      noColor?: boolean;
    }) => {
      await runContext(task, options);
    });

  program
    .command('start')
    .argument('<task>', 'Task to start working on')
    .description('Start a focused task with context pack and next-action guidance.')
    .option('--module <module>', 'Prefer memory and questions for one module or area')
    .option('--limit <number>', 'Maximum relevant items per section')
    .option('--budget-lines <number>', 'Approximate maximum output lines')
    .option('--json', 'Print structured JSON')
    .option('--stats', 'Print estimated token savings')
    .action(async (task: string, options: {
      module?: string;
      limit?: string;
      budgetLines?: string;
      json?: boolean;
      stats?: boolean;
    }) => {
      await runStart(task, options);
    });

  program
    .command('close')
    .description('Save session memory interactively or with flags.')
    .option('--change <summary>', 'What changed in this session')
    .option('--decision <summary>', 'Decision made')
    .option('--error <summary>', 'Error solved')
    .option('--next <summary>', 'What the next session should know')
    .option('--module <module>', 'Related module or area')
    .option('--allow-duplicate', 'Allow duplicate entries')
    .action(async (options: {
      change?: string;
      decision?: string;
      error?: string;
      next?: string;
      module?: string;
      allowDuplicate?: boolean;
    }) => {
      await runClose(options);
    });

  const plan = program
    .command('plan')
    .description('Manage the structured orchestration plan (.agent-flow/plan.json).');

  plan
    .command('init')
    .description('Create .agent-flow/plan.json, seeded from REQUIREMENTS.md requirement ids.')
    .option('--force', 'Recreate the plan even if one already exists')
    .option('--json', 'Print structured JSON')
    .action(async (options: { force?: boolean; json?: boolean }) => {
      await runPlanInit(options);
    });

  plan
    .command('validate')
    .description('Validate plan structure: requirement coverage, dependency DAG, and waves.')
    .option('--json', 'Print structured JSON')
    .action(async (options: { json?: boolean }) => {
      await runPlanValidate(options);
    });

  plan
    .command('show')
    .description('Render plan phases, task status, progress, and the next actionable task.')
    .option('--json', 'Print structured JSON')
    .action(async (options: { json?: boolean }) => {
      await runPlanShow(options);
    });

  program
    .command('next')
    .description('Show the next actionable task with a scoped context pack and gate commands.')
    .option('--budget-lines <number>', 'Approximate maximum context-pack lines')
    .option('--json', 'Print structured JSON')
    .action(async (options: { budgetLines?: string; json?: boolean }) => {
      await runNext(options);
    });

  program
    .command('gate')
    .description('Run the gate commands (tests/typecheck/...) for a task and cache the result.')
    .option('--task <id>', 'Task id to gate (defaults to the next actionable task)')
    .option('--json', 'Print structured JSON')
    .action(async (options: { task?: string; json?: boolean }) => {
      await runGateCommand(options);
    });

  program
    .command('advance')
    .description('Mark a task done if its gate is green, append memory, and move the cursor.')
    .option('--task <id>', 'Task id to advance (defaults to the next actionable task)')
    .option('--gate', 'Run gates now instead of requiring a cached green result')
    .option('--json', 'Print structured JSON')
    .action(async (options: { task?: string; gate?: boolean; json?: boolean }) => {
      await runAdvance(options);
    });

  const memory = program.command('memory').description('Inspect local JSONL memory.');

  memory
    .command('list')
    .description('List memory files and recent entries.')
    .action(async () => {
      await runMemoryList();
    });

  memory
    .command('search')
    .argument('<query>', 'Text to search for in memory JSONL files')
    .description('Search local memory entries.')
    .option('--file <file>', 'Memory file: events, decisions, errors, or modules')
    .option('--type <type>', 'Filter by exact memory type')
    .option('--module <module>', 'Filter by exact module')
    .option('--limit <limit>', 'Maximum matches to print')
    .action(async (query: string, options: { file?: string; type?: string; module?: string; limit?: string }) => {
      await runMemorySearch(query, options);
    });

  memory
    .command('query')
    .argument('<query>', 'Text to query in the indexed project memory')
    .description('Query the internal SQLite memory index.')
    .option('--module <module>', 'Filter by exact module')
    .option('--drawer <drawer>', 'Filter by memory drawer')
    .option('--type <type>', 'Filter by exact memory type')
    .option('--status <status>', 'Filter by exact status')
    .option('--limit <limit>', 'Maximum matches to print')
    .option('--json', 'Print structured JSON')
    .action(async (query: string, options: { module?: string; drawer?: string; type?: string; status?: string; limit?: string; json?: boolean }) => {
      await runMemoryQuery(query, options);
    });

  memory
    .command('inspect')
    .description('Inspect the internal SQLite memory index.')
    .action(async () => {
      await runMemoryInspect();
    });

  memory
    .command('rebuild')
    .description('Rebuild the internal SQLite memory index from JSONL memory.')
    .option('--dry-run', 'Print what would happen without modifying the index')
    .option('--json', 'Print structured JSON')
    .action(async (options: { dryRun?: boolean; json?: boolean }) => {
      await runMemoryRebuild(options);
    });

  memory
    .command('context')
    .argument('<query>', 'Text to build a compact local memory context pack')
    .description('Build a compact deterministic context pack from local memory.')
    .option('--limit <limit>', 'Maximum matches per memory file')
    .action(async (query: string, options: { limit?: string }) => {
      await runMemoryContext(query, options);
    });

  memory
    .command('validate')
    .description('Validate all local memory JSONL entries without modifying files.')
    .action(async () => {
      await runMemoryValidate();
    });

  memory
    .command('append')
    .description('Append one safe JSONL memory entry.')
    .requiredOption('--file <file>', 'Memory file: events, decisions, errors, or modules')
    .requiredOption('--type <type>', 'Memory entry type')
    .requiredOption('--summary <summary>', 'Short memory summary')
    .option('--module <module>', 'Related module or area')
    .option('--status <status>', 'Decision status')
    .option('--rationale <rationale>', 'Decision rationale')
    .option('--alternatives <items>', 'Comma-separated decision alternatives')
    .option('--cause <cause>', 'Known error cause')
    .option('--solution <solution>', 'Known error solution')
    .option('--files <files>', 'Comma-separated related files')
    .option('--tags <tags>', 'Comma-separated tags')
    .option('--allow-duplicate', 'Append even if an exact duplicate already exists')
    .action(async (options: {
      file: string;
      type: string;
      summary: string;
      module?: string;
      status?: string;
      rationale?: string;
      alternatives?: string;
      cause?: string;
      solution?: string;
      files?: string;
      tags?: string;
      allowDuplicate?: boolean;
    }) => {
      await runMemoryAppend(options);
    });

  program.showHelpAfterError();
  return program;
}

export function isCliEntrypoint(metaUrl: string, argvPath = process.argv[1]): boolean {
  if (!argvPath) return false;

  const modulePath = fileURLToPath(metaUrl);
  const resolvedArgvPath = path.resolve(argvPath);

  try {
    return fs.realpathSync(modulePath) === fs.realpathSync(resolvedArgvPath);
  } catch {
    return path.resolve(modulePath) === resolvedArgvPath;
  }
}

async function runFirstRunOrDashboard(): Promise<void> {
  const root = process.cwd();
  const configExists = fs.existsSync(path.join(root, '.agent-flow', 'config.json'));

  if (configExists) {
    await runDashboard();
    return;
  }

  console.log(brandTitle('agent-flow'));
  console.log('');
  console.log(pc.yellow('This repo is not configured for Agent Flow.'));
  console.log('');
  console.log('Recommended setup:');
  console.log(`  1. ${pc.cyan('agent-flow init --codex')}  or  ${pc.cyan('agent-flow init --claude')}`);
  console.log(`  2. ${pc.cyan('agent-flow onboard')}`);
  console.log(`  3. ${pc.cyan('agent-flow doctor')}`);

  const isTTY = Boolean(process.stdin.isTTY && process.stdout.isTTY && !process.env.CI);
  if (!isTTY) return;

  console.log('');
  const readline = await import('node:readline/promises');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let agentChoice: string;
  try {
    const answer = await rl.question(`${pc.cyan('?')} Run setup now? (y/N) `);
    if (answer.trim().toLowerCase() !== 'y') return;

    console.log('');
    console.log('Which agent setup do you want?');
    console.log(`  1. ${pc.cyan('Codex')}`);
    console.log(`  2. ${pc.cyan('Claude')}`);
    console.log(`  3. ${pc.cyan('Both')}`);
    console.log(`  4. ${pc.dim('Base files only')}`);
    console.log('');
    agentChoice = (await rl.question(`${pc.cyan('?')} Choice (1-4): `)).trim();
  } finally {
    rl.close();
  }

  const initOptions: { codex?: boolean; claude?: boolean; cwd: string } = { cwd: root };
  if (agentChoice === '1') initOptions.codex = true;
  else if (agentChoice === '2') initOptions.claude = true;
  else if (agentChoice === '3') { initOptions.codex = true; initOptions.claude = true; }

  console.log('');
  await runInit(initOptions);
  console.log('');
  await runOnboard({ cwd: root });
  console.log('');
  await runDoctor({ cwd: root });
}

if (isCliEntrypoint(import.meta.url)) {
  try {
    if (process.argv.length <= 2) {
      await runFirstRunOrDashboard();
    } else {
      await createProgram().parseAsync(process.argv);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(pc.red(message));
    process.exitCode = 1;
  }
}

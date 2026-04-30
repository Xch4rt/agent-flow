#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import pc from 'picocolors';
import { fileURLToPath } from 'node:url';
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
import { runStatus } from './commands/status.js';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('agent-flow')
    .description('Codex-first workflow and memory layer for software project continuity.')
    .version('0.5.0');

  program
    .command('init')
    .description('Initialize agent-flow planning, memory, and optional Codex skill files.')
    .option('--codex', 'Install Codex skill workflows')
    .option('--force', 'Overwrite existing generated files')
    .option('--force-memory', 'Overwrite existing memory JSONL files')
    .action(async (options: { codex?: boolean; force?: boolean; forceMemory?: boolean }) => {
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
    .option('--no-color', 'Disable colored output')
    .action(async (task: string, options: {
      module?: string;
      limit?: string;
      budgetLines?: string;
      json?: boolean;
      includeEvents?: boolean;
      includeOpenQuestions?: boolean;
      noColor?: boolean;
    }) => {
      await runContext(task, options);
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

if (isCliEntrypoint(import.meta.url)) {
  try {
    await createProgram().parseAsync(process.argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(pc.red(message));
    process.exitCode = 1;
  }
}

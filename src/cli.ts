#!/usr/bin/env node
import { Command } from 'commander';
import pc from 'picocolors';
import { runDoctor } from './commands/doctor.js';
import { runInit } from './commands/init.js';
import { runMemoryAppend, runMemoryContext, runMemoryList, runMemorySearch, runMemoryValidate } from './commands/memory.js';
import { runOnboard } from './commands/onboard.js';
import { runStatus } from './commands/status.js';

const program = new Command();

program
  .name('agent-flow')
  .description('Codex-first workflow and memory layer for software project continuity.')
  .version('0.3.0');

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

try {
  await program.parseAsync(process.argv);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(pc.red(message));
  process.exitCode = 1;
}

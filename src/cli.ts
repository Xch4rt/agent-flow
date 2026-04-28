#!/usr/bin/env node
import { Command } from 'commander';
import pc from 'picocolors';
import { runDoctor } from './commands/doctor.js';
import { runInit } from './commands/init.js';
import { runMemoryAppend, runMemoryList, runMemorySearch } from './commands/memory.js';
import { runStatus } from './commands/status.js';

const program = new Command();

program
  .name('agent-flow')
  .description('Codex-first workflow and memory layer for software project continuity.')
  .version('0.1.0');

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
  .action(async (query: string) => {
    await runMemorySearch(query);
  });

memory
  .command('append')
  .description('Append one safe JSONL memory entry.')
  .requiredOption('--file <file>', 'Memory file: events, decisions, errors, or modules')
  .requiredOption('--type <type>', 'Memory entry type')
  .requiredOption('--summary <summary>', 'Short memory summary')
  .option('--module <module>', 'Related module or area')
  .action(async (options: { file: string; type: string; summary: string; module?: string }) => {
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

import path from 'node:path';
import fs from 'fs-extra';
import pc from 'picocolors';
import { detectProject } from '../core/detect-project.js';
import { getInvalidMemoryEntries, getMemoryFiles, readMemoryEntries } from '../core/jsonl-memory.js';
import { getOnboardingState } from '../core/onboard.js';
import { codexSkillFiles, planningFiles } from './doctor.js';

const coreFiles = [
  'AGENTS.md',
  '.agent-flow/config.json',
];

function formatDate(date: Date): string {
  return date.toISOString();
}

async function modifiedAt(filePath: string): Promise<string> {
  if (!(await fs.pathExists(filePath))) return 'missing';
  const stat = await fs.stat(filePath);
  return formatDate(stat.mtime);
}

function commandLine(label: string, value: string | undefined): string {
  return `  ${label}: ${value ?? 'not detected'}`;
}

export async function runStatus(options: { cwd?: string } = {}): Promise<void> {
  const root = options.cwd ?? process.cwd();
  const detection = await detectProject(root);
  const memoryFiles = getMemoryFiles(root);
  const expectedFiles = [...coreFiles, ...planningFiles, ...memoryFiles.map((file) => path.relative(root, file))];
  const missingCore = [];
  const missingPlanning = [];
  const missingMemory = [];
  const missingSkills = [];

  for (const file of expectedFiles) {
    if (!(await fs.pathExists(path.join(root, file)))) {
      if (planningFiles.includes(file)) {
        missingPlanning.push(file);
      } else if (file.startsWith('.memory/')) {
        missingMemory.push(file);
      } else {
        missingCore.push(file);
      }
    }
  }

  for (const file of codexSkillFiles) {
    if (!(await fs.pathExists(path.join(root, file)))) {
      missingSkills.push(file);
    }
  }

  const memoryEntries = await readMemoryEntries(root);
  const invalidMemoryEntries = getInvalidMemoryEntries(memoryEntries);
  const eventsPath = path.join(root, '.memory/events.jsonl');
  const eventsExists = await fs.pathExists(eventsPath);
  const eventsContent = eventsExists ? await fs.readFile(eventsPath, 'utf8') : '';
  const statePath = path.join(root, '.planning/STATE.md');
  const onboarding = await getOnboardingState(root);
  const likelyNotOnboarded = !onboarding.onboarded;

  console.log(pc.bold('agent-flow status'));
  console.log(`Package manager: ${detection.packageManager}`);
  console.log(`Detected stack: ${detection.stacks.length ? detection.stacks.join(', ') : 'none'}`);
  console.log('Detected commands:');
  console.log(commandLine('install', detection.commands.install));
  console.log(commandLine('dev', detection.commands.dev));
  console.log(commandLine('build', detection.commands.build));
  console.log(commandLine('test', detection.commands.test));
  console.log(commandLine('lint', detection.commands.lint));
  console.log(commandLine('typecheck', detection.commands.typecheck));

  console.log(`Missing core files: ${missingCore.length}`);
  console.log(`Missing planning files: ${missingPlanning.length}`);
  console.log(`Missing memory files: ${missingMemory.length}`);
  console.log(`Invalid memory entries: ${invalidMemoryEntries.length}`);
  console.log(`Missing Codex skills: ${missingSkills.length}`);
  console.log(`Onboarded: ${onboarding.onboarded ? 'yes' : 'no'}`);
  console.log(`Last onboarded: ${onboarding.lastOnboardedAt ?? 'never'}`);

  console.log(`Planning state modified: ${await modifiedAt(statePath)}`);
  console.log('Memory files:');

  for (const file of memoryFiles) {
    const relativePath = path.relative(root, file);
    const entries = memoryEntries.filter((entry) => entry.file === relativePath).length;
    console.log(`  ${relativePath}: ${entries} entries, modified ${await modifiedAt(file)}`);
  }

  const warnings = [
    ...missingPlanning.map((file) => `missing planning file: ${file}`),
    ...missingMemory.map((file) => `missing memory file: ${file}`),
    ...missingSkills.map((file) => `missing Codex skill: ${file}`),
    invalidMemoryEntries.length > 0 ? `invalid memory entries: ${invalidMemoryEntries.length}` : undefined,
    eventsExists && !eventsContent.trim() ? 'empty .memory/events.jsonl' : undefined,
    likelyNotOnboarded ? 'project is likely not onboarded; run agent-flow onboard' : undefined,
  ].filter((warning): warning is string => Boolean(warning));

  if (warnings.length > 0) {
    console.log(pc.yellow('Warnings:'));
    for (const warning of warnings) {
      console.log(`${pc.yellow('warning')} ${warning}`);
    }
  } else {
    console.log(`${pc.green('ok')} no obvious warnings`);
  }
}

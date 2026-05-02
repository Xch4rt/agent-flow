import path from 'node:path';
import fs from 'fs-extra';
import { detectProject } from '../core/detect-project.js';
import { getInvalidMemoryEntries, getMemoryFiles, readMemoryEntries } from '../core/jsonl-memory.js';
import { getMemoryIndexState, inspectMemoryIndex } from '../core/memory-index.js';
import { getOnboardingState } from '../core/onboard.js';
import { brandTitle, keyValue, section, statusLabel } from '../core/terminal-ui.js';
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
  return keyValue(`  ${label}:`, value ?? 'not detected');
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
  const memoryIndexState = await getMemoryIndexState(root);
  const memoryIndexInspect = memoryIndexState.exists ? await inspectMemoryIndex(root) : undefined;

  console.log(brandTitle('agent-flow status'));
  console.log(keyValue('Package manager:', detection.packageManager));
  console.log(keyValue('Detected stack:', detection.stacks.length ? detection.stacks.join(', ') : 'none'));
  console.log(section('Detected commands:'));
  console.log(commandLine('install', detection.commands.install));
  console.log(commandLine('dev', detection.commands.dev));
  console.log(commandLine('build', detection.commands.build));
  console.log(commandLine('test', detection.commands.test));
  console.log(commandLine('lint', detection.commands.lint));
  console.log(commandLine('typecheck', detection.commands.typecheck));

  console.log(section('Project health:'));
  console.log(keyValue('Missing core files:', String(missingCore.length)));
  console.log(keyValue('Missing planning files:', String(missingPlanning.length)));
  console.log(keyValue('Missing memory files:', String(missingMemory.length)));
  console.log(keyValue('Invalid memory entries:', String(invalidMemoryEntries.length)));
  console.log(keyValue('Context pack memory:', memoryEntries.length >= 3 ? 'enough for useful packs' : 'limited'));
  console.log(keyValue('Memory index DB:', memoryIndexState.exists ? 'yes' : 'no'));
  console.log(keyValue('Memory index state:', memoryIndexState.status));
  console.log(keyValue('Memory index in sync:', memoryIndexState.status === 'in sync' ? 'yes' : 'no'));
  console.log(keyValue('Memory index last sync:', memoryIndexState.lastSyncAt ?? 'never'));
  console.log(keyValue('Indexed entries:', String(memoryIndexInspect ? Object.values(memoryIndexInspect.entryCounts).reduce((sum, count) => sum + count, 0) : 0)));
  console.log(keyValue('Missing Codex skills:', String(missingSkills.length)));
  console.log(keyValue('Onboarded:', onboarding.onboarded ? 'yes' : 'no'));
  console.log(keyValue('Last onboarded:', onboarding.lastOnboardedAt ?? 'never'));

  console.log(keyValue('Planning state modified:', await modifiedAt(statePath)));
  console.log(section('Memory files:'));

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
    memoryIndexState.status === 'stale' ? 'memory index is stale; memory query/context will auto-sync or run agent-flow memory rebuild' : undefined,
    eventsExists && !eventsContent.trim() ? 'empty .memory/events.jsonl' : undefined,
    likelyNotOnboarded ? 'project is likely not onboarded; run agent-flow onboard' : undefined,
  ].filter((warning): warning is string => Boolean(warning));

  if (warnings.length > 0) {
    console.log(section('Warnings:'));
    for (const warning of warnings) {
      console.log(`${statusLabel('warning')} ${warning}`);
    }
  } else {
    console.log(`${statusLabel('ok')} no obvious warnings`);
  }
}

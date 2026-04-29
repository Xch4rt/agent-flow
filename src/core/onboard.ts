import path from 'node:path';
import fs from 'fs-extra';
import { execa } from 'execa';
import type { ProjectDetection } from './detect-project.js';
import { detectProject } from './detect-project.js';
import { appendMemoryEntry, readMemoryEntries } from './jsonl-memory.js';

export const onboardStartMarker = '<!-- agent-flow:onboard:start -->';
export const onboardEndMarker = '<!-- agent-flow:onboard:end -->';

export type GitContext = {
  branch?: string;
  lastCommit?: string;
  dirty: boolean;
};

export type RepoInspection = {
  detection: ProjectDetection;
  importantFiles: string[];
  importantDirectories: string[];
  git: GitContext;
  risks: string[];
};

export type OnboardingState = {
  onboarded: boolean;
  hasGeneratedSections: boolean;
  hasOnboardingEvent: boolean;
  lastOnboardedAt?: string;
};

const importantFileCandidates = [
  'package.json',
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'tsconfig.json',
  'vite.config.ts',
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'nest-cli.json',
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
  'prisma/schema.prisma',
  'pyproject.toml',
  'requirements.txt',
  'README.md',
];

const importantDirectoryCandidates = [
  'src',
  'app',
  'pages',
  'components',
  'server',
  'api',
  'lib',
  'prisma',
  'test',
  'tests',
  'docs',
];

function list(values: string[], fallback = 'None detected.'): string {
  return values.length ? values.map((value) => `- ${value}`).join('\n') : `- ${fallback}`;
}

function commandList(detection: ProjectDetection): string {
  return [
    `- Install: ${detection.commands.install ?? 'Not detected'}`,
    `- Dev: ${detection.commands.dev ?? 'Not detected'}`,
    `- Build: ${detection.commands.build ?? 'Not detected'}`,
    `- Test: ${detection.commands.test ?? 'Not detected'}`,
    `- Lint: ${detection.commands.lint ?? 'Not detected'}`,
    `- Typecheck: ${detection.commands.typecheck ?? 'Not detected'}`,
  ].join('\n');
}

async function maybeGit(root: string, args: string[]): Promise<string | undefined> {
  try {
    const result = await execa('git', args, { cwd: root });
    return result.stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function inspectGit(root: string): Promise<GitContext> {
  const branch = await maybeGit(root, ['branch', '--show-current']);
  const lastCommit = await maybeGit(root, ['log', '-1', '--oneline']);
  const status = await maybeGit(root, ['status', '--short']);

  return {
    branch,
    lastCommit,
    dirty: Boolean(status),
  };
}

async function existingPaths(root: string, candidates: string[]): Promise<string[]> {
  const found = [];

  for (const candidate of candidates) {
    if (await fs.pathExists(path.join(root, candidate))) {
      found.push(candidate);
    }
  }

  return found;
}

function risksFor(inspection: RepoInspection): string[] {
  const risks = [];

  if (!inspection.detection.commands.test) risks.push('No test command detected.');
  if (!inspection.detection.commands.build) risks.push('No build command detected.');
  if (inspection.git.dirty) risks.push('Git working tree has uncommitted changes.');
  if (inspection.detection.packageManager === 'unknown') risks.push('Package manager not detected.');
  if (inspection.detection.stacks.length === 0) risks.push('Application stack not detected.');

  return risks;
}

export async function inspectRepository(root: string): Promise<RepoInspection> {
  const detection = await detectProject(root);
  const importantFiles = await existingPaths(root, importantFileCandidates);
  const importantDirectories = await existingPaths(root, importantDirectoryCandidates);
  const git = await inspectGit(root);
  const inspection: RepoInspection = {
    detection,
    importantFiles,
    importantDirectories,
    git,
    risks: [],
  };

  inspection.risks = risksFor(inspection);

  return inspection;
}

function generatedBlock(content: string): string {
  return `${onboardStartMarker}\n${content.trim()}\n${onboardEndMarker}\n`;
}

export function upsertGeneratedSection(existing: string, generated: string, options: { canReplace?: boolean } = {}): string {
  const block = generatedBlock(generated);
  const start = existing.indexOf(onboardStartMarker);
  const end = existing.indexOf(onboardEndMarker);

  if (start !== -1 && end !== -1 && end > start) {
    if (!options.canReplace) {
      return existing;
    }

    const afterEnd = end + onboardEndMarker.length;
    return `${existing.slice(0, start)}${block}${existing.slice(afterEnd).replace(/^\n/, '')}`;
  }

  const separator = existing.trim() ? '\n\n' : '';
  return `${existing.trimEnd()}${separator}${block}`;
}

function projectSection(inspection: RepoInspection): string {
  return `## Agent Flow Onboarding

### Detected Stack

${list(inspection.detection.stacks, 'No framework or runtime stack detected.')}

### Package Manager

${inspection.detection.packageManager}

### Important Files

${list(inspection.importantFiles)}

### Important Directories

${list(inspection.importantDirectories)}`;
}

function stateSection(inspection: RepoInspection): string {
  return `## Agent Flow Onboarding State

### Commands

${commandList(inspection.detection)}

### Git Context

- Branch: ${inspection.git.branch ?? 'Not detected'}
- Last commit: ${inspection.git.lastCommit ?? 'Not detected'}
- Dirty working tree: ${inspection.git.dirty ? 'yes' : 'no'}

### Risks

${list(inspection.risks, 'No obvious baseline risks detected.')}`;
}

function openQuestionsSection(inspection: RepoInspection): string {
  const questions = [];

  if (!inspection.detection.commands.test) questions.push('What command should agents use to verify tests?');
  if (!inspection.detection.commands.build) questions.push('What command should agents use to verify builds?');
  if (inspection.detection.stacks.length === 0) questions.push('What is the primary application stack?');
  if (inspection.importantDirectories.length === 0) questions.push('Which directories contain the main application code?');

  return `## Agent Flow Open Questions

${list(questions, 'No generated open questions.')}`;
}

function existingModuleNames(entries: Awaited<ReturnType<typeof readMemoryEntries>>): Set<string> {
  return new Set(
    entries
      .map((entry) => {
        if (typeof entry.value !== 'object' || entry.value === null) return undefined;
        const value = entry.value as { type?: unknown; module?: unknown };
        return value.type === 'module' && typeof value.module === 'string' ? value.module : undefined;
      })
      .filter((value): value is string => Boolean(value)),
  );
}

async function readText(filePath: string): Promise<string> {
  if (!(await fs.pathExists(filePath))) return '';
  return fs.readFile(filePath, 'utf8');
}

async function writeSection(
  root: string,
  relativePath: string,
  generated: string,
  options: { dryRun?: boolean; canReplace?: boolean },
): Promise<{ path: string; changed: boolean; content: string }> {
  const filePath = path.join(root, relativePath);
  const existing = await readText(filePath);
  const next = upsertGeneratedSection(existing, generated, { canReplace: options.canReplace });
  const changed = next !== existing;

  if (changed && !options.dryRun) {
    await fs.ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, next);
  }

  return { path: relativePath, changed, content: next };
}

export async function getOnboardingState(root: string): Promise<OnboardingState> {
  const planningPaths = ['.planning/PROJECT.md', '.planning/STATE.md', '.planning/OPEN_QUESTIONS.md'];
  const hasGeneratedSections = (
    await Promise.all(
      planningPaths.map(async (file) => {
        const content = await readText(path.join(root, file));
        return content.includes(onboardStartMarker) && content.includes(onboardEndMarker);
      }),
    )
  ).every(Boolean);
  const entries = await readMemoryEntries(root);
  const onboardingEvents = entries.filter((entry) => {
    if (typeof entry.value !== 'object' || entry.value === null) return false;
    const value = entry.value as { type?: unknown; createdAt?: unknown };
    return value.type === 'onboard';
  });
  const lastOnboardedAt = onboardingEvents
    .map((entry) => (entry.value as { createdAt?: unknown }).createdAt)
    .filter((value): value is string => typeof value === 'string')
    .sort()
    .at(-1);

  return {
    onboarded: hasGeneratedSections && onboardingEvents.length > 0,
    hasGeneratedSections,
    hasOnboardingEvent: onboardingEvents.length > 0,
    lastOnboardedAt,
  };
}

export type OnboardResult = {
  inspection: RepoInspection;
  planning: Array<{ path: string; changed: boolean; content: string }>;
  memoryAppended: string[];
  skippedMemory: boolean;
};

export async function onboardRepository(
  root: string,
  options: { dryRun?: boolean; refresh?: boolean; force?: boolean } = {},
): Promise<OnboardResult> {
  const inspection = await inspectRepository(root);
  const canReplace = Boolean(options.refresh || options.force);
  const planning = [
    await writeSection(root, '.planning/PROJECT.md', projectSection(inspection), { dryRun: options.dryRun, canReplace }),
    await writeSection(root, '.planning/STATE.md', stateSection(inspection), { dryRun: options.dryRun, canReplace }),
    await writeSection(root, '.planning/OPEN_QUESTIONS.md', openQuestionsSection(inspection), {
      dryRun: options.dryRun,
      canReplace,
    }),
  ];
  const state = await getOnboardingState(root);
  const shouldAppendMemory = options.refresh || !state.hasOnboardingEvent;
  const memoryAppended: string[] = [];
  const entries = await readMemoryEntries(root);
  const knownModules = existingModuleNames(entries);

  if (shouldAppendMemory && !options.dryRun) {
    await appendMemoryEntry(root, 'events', {
      type: 'onboard',
      summary: `Detected ${inspection.detection.stacks.join(', ') || 'unknown stack'} with ${inspection.detection.packageManager} package manager.`,
      module: 'agent-flow',
    });
    memoryAppended.push('.memory/events.jsonl');

    const newDirectories = inspection.importantDirectories.slice(0, 5).filter((directory) => !knownModules.has(directory));

    for (const directory of newDirectories) {
      await appendMemoryEntry(root, 'modules', {
        type: 'module',
        summary: `Important directory detected during onboarding: ${directory}.`,
        module: directory,
      });
    }

    if (newDirectories.length > 0) {
      memoryAppended.push('.memory/modules.jsonl');
    }
  }

  return {
    inspection,
    planning,
    memoryAppended,
    skippedMemory: !shouldAppendMemory,
  };
}

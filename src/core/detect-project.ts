import path from 'node:path';
import fs from 'fs-extra';
import { z } from 'zod';

const PackageManagerSchema = z.enum(['pnpm', 'npm', 'yarn', 'bun', 'uv', 'poetry', 'pip', 'cargo', 'go', 'unknown']);
const StackNameSchema = z.enum([
  'Next.js',
  'NestJS',
  'Express',
  'Fastify',
  'Prisma',
  'Python',
  'Go',
  'Rust',
  'Docker',
  'Node',
  'TypeScript',
]);
const TestRunnerSchema = z.enum(['vitest', 'jest', 'node:test', 'mocha']);

export type PackageManager = z.infer<typeof PackageManagerSchema>;
export type StackName = z.infer<typeof StackNameSchema>;
export type TestRunner = z.infer<typeof TestRunnerSchema>;

export type WorkspaceCommands = {
  test?: string;
  build?: string;
  lint?: string;
  typecheck?: string;
};

export type Workspace = {
  name: string;
  path: string;
  commands: WorkspaceCommands;
};

export type ProjectDetection = {
  root: string;
  packageManager: PackageManager;
  stacks: StackName[];
  testRunner?: TestRunner;
  workspaces?: Workspace[];
  workspacesTotal?: number;
  workspaceTool?: 'pnpm' | 'npm' | 'yarn' | 'turbo';
  scripts: Record<string, string>;
  commands: {
    install?: string;
    dev?: string;
    build?: string;
    test?: string;
    lint?: string;
    typecheck?: string;
  };
};

async function exists(root: string, relativePath: string): Promise<boolean> {
  return fs.pathExists(path.join(root, relativePath));
}

async function readPackageJson(root: string): Promise<Record<string, unknown> | undefined> {
  const packageJsonPath = path.join(root, 'package.json');

  if (!(await fs.pathExists(packageJsonPath))) {
    return undefined;
  }

  return fs.readJson(packageJsonPath);
}

function detectStackFromPackageJson(packageJson: Record<string, unknown> | undefined): StackName[] {
  const deps = {
    ...(typeof packageJson?.dependencies === 'object' ? packageJson.dependencies : {}),
    ...(typeof packageJson?.devDependencies === 'object' ? packageJson.devDependencies : {}),
  } as Record<string, unknown>;

  const stacks = new Set<StackName>();

  if ('next' in deps) stacks.add('Next.js');
  if ('@nestjs/core' in deps) stacks.add('NestJS');
  if ('express' in deps) stacks.add('Express');
  if ('fastify' in deps) stacks.add('Fastify');
  if ('prisma' in deps || '@prisma/client' in deps) stacks.add('Prisma');

  return [...stacks];
}

function detectScripts(packageJson: Record<string, unknown> | undefined): Record<string, string> {
  if (!packageJson || typeof packageJson.scripts !== 'object' || packageJson.scripts === null) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(packageJson.scripts).filter((entry): entry is [string, string] => {
      return typeof entry[1] === 'string';
    }),
  );
}

function allDeps(packageJson: Record<string, unknown> | undefined): Record<string, unknown> {
  return {
    ...(typeof packageJson?.dependencies === 'object' ? packageJson.dependencies : {}),
    ...(typeof packageJson?.devDependencies === 'object' ? packageJson.devDependencies : {}),
  } as Record<string, unknown>;
}

function detectTestRunner(
  packageJson: Record<string, unknown> | undefined,
  scripts: Record<string, string>,
): TestRunner | undefined {
  const deps = allDeps(packageJson);
  if ('vitest' in deps) return 'vitest';
  if ('jest' in deps) return 'jest';
  if ('mocha' in deps) return 'mocha';
  const testScript = [scripts.test, scripts['test:unit']].filter(Boolean).join(' ');
  if (/\bvitest\b/.test(testScript)) return 'vitest';
  if (/\bjest\b/.test(testScript)) return 'jest';
  if (/\bmocha\b/.test(testScript)) return 'mocha';
  if (/node(\s+--\S+)*\s+--test\b|node:test/.test(testScript)) return 'node:test';
  return undefined;
}

function execPrefix(packageManager: PackageManager): string {
  if (packageManager === 'pnpm') return 'pnpm exec';
  if (packageManager === 'yarn') return 'yarn';
  if (packageManager === 'bun') return 'bunx';
  return 'npx';
}

const ESLINT_CONFIGS = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.json',
  '.eslintrc.yml',
  '.eslintrc.yaml',
];

async function detectPackageManager(
  root: string,
  packageJson?: Record<string, unknown>,
): Promise<PackageManager> {
  if (await exists(root, 'pnpm-lock.yaml')) return 'pnpm';
  if (await exists(root, 'package-lock.json')) return 'npm';
  if (await exists(root, 'yarn.lock')) return 'yarn';
  if (await exists(root, 'bun.lockb')) return 'bun';
  if (await exists(root, 'bun.lock')) return 'bun';
  const declared = typeof packageJson?.packageManager === 'string' ? packageJson.packageManager : '';
  const name = declared.split('@')[0];
  if (name === 'pnpm' || name === 'npm' || name === 'yarn' || name === 'bun') return name;
  if (packageJson) return 'npm';
  return 'unknown';
}

function runPrefix(packageManager: PackageManager): string {
  if (packageManager === 'unknown') return 'npm run';
  if (packageManager === 'npm') return 'npm run';
  if (packageManager === 'yarn') return 'yarn';
  if (packageManager === 'bun') return 'bun run';
  return 'pnpm';
}

function installCommand(packageManager: PackageManager): string | undefined {
  if (packageManager === 'unknown') return undefined;
  if (packageManager === 'npm') return 'npm install';
  if (packageManager === 'yarn') return 'yarn install';
  if (packageManager === 'bun') return 'bun install';
  return 'pnpm install';
}

function commandForScript(
  scripts: Record<string, string>,
  packageManager: PackageManager,
  names: string[],
): string | undefined {
  const script = names.find((name) => name in scripts);
  if (!script) return undefined;
  return `${runPrefix(packageManager)} ${script}`;
}

type Commands = ProjectDetection['commands'];
type LanguageDetection = { packageManager: PackageManager; commands: Commands };

async function readText(root: string, relativePath: string): Promise<string> {
  const file = path.join(root, relativePath);
  return (await fs.pathExists(file)) ? fs.readFile(file, 'utf8') : '';
}

async function detectPython(root: string): Promise<LanguageDetection | undefined> {
  const hasPyproject = await exists(root, 'pyproject.toml');
  const hasRequirements = await exists(root, 'requirements.txt');
  const hasPipfile = await exists(root, 'Pipfile');
  const hasPoetryLock = await exists(root, 'poetry.lock');
  if (!hasPyproject && !hasRequirements && !hasPipfile && !hasPoetryLock) return undefined;

  const pyproject = await readText(root, 'pyproject.toml');
  const requirements = await readText(root, 'requirements.txt');
  const hasUvLock = await exists(root, 'uv.lock');
  const isPoetry = hasPoetryLock || /^\[tool\.poetry\b/m.test(pyproject);
  const isUv = hasUvLock || /^\[tool\.uv\b/m.test(pyproject);
  const packageManager: PackageManager = isUv ? 'uv' : isPoetry ? 'poetry' : 'pip';
  const run = packageManager === 'uv' ? 'uv run ' : packageManager === 'poetry' ? 'poetry run ' : '';

  const mentions = (name: string): boolean =>
    new RegExp(`\\b${name}\\b`, 'i').test(pyproject) ||
    new RegExp(`^\\s*${name}\\b`, 'im').test(requirements);
  const hasPytest =
    mentions('pytest') ||
    (await exists(root, 'pytest.ini')) ||
    (await exists(root, 'conftest.py')) ||
    (await exists(root, 'tests'));
  const hasRuff = mentions('ruff') || (await exists(root, 'ruff.toml')) || (await exists(root, '.ruff.toml'));
  const hasFlake8 = mentions('flake8') || (await exists(root, '.flake8'));

  const install =
    packageManager === 'uv'
      ? 'uv sync'
      : packageManager === 'poetry'
        ? 'poetry install'
        : hasRequirements
          ? 'pip install -r requirements.txt'
          : 'pip install -e .';

  return {
    packageManager,
    commands: {
      install,
      ...(hasPytest ? { test: `${run}pytest` } : {}),
      ...(hasRuff ? { lint: `${run}ruff check .` } : hasFlake8 ? { lint: `${run}flake8` } : {}),
    },
  };
}

async function detectGo(root: string): Promise<LanguageDetection | undefined> {
  if (!(await exists(root, 'go.mod'))) return undefined;
  return {
    packageManager: 'go',
    commands: {
      install: 'go mod download',
      build: 'go build ./...',
      test: 'go test ./...',
      lint: 'go vet ./...',
    },
  };
}

async function detectRust(root: string): Promise<LanguageDetection | undefined> {
  if (!(await exists(root, 'Cargo.toml'))) return undefined;
  return {
    packageManager: 'cargo',
    commands: {
      install: 'cargo fetch',
      build: 'cargo build',
      test: 'cargo test',
      lint: 'cargo clippy',
    },
  };
}

function workspaceScriptCommand(
  packageManager: PackageManager,
  name: string,
  script: string,
): string {
  if (packageManager === 'pnpm') return `pnpm --filter ${name} ${script}`;
  if (packageManager === 'yarn') return `yarn workspace ${name} ${script}`;
  if (packageManager === 'bun') return `bun run --filter ${name} ${script}`;
  return `npm run ${script} --workspace ${name}`;
}

async function readPackageJsonSafe(dir: string): Promise<Record<string, unknown> | undefined> {
  try {
    return await readPackageJson(dir);
  } catch {
    return undefined;
  }
}

export const MAX_WORKSPACES = 25;

const SAFE_PACKAGE_NAME = /^[@A-Za-z0-9][A-Za-z0-9._/-]*$/;

function insideRoot(pattern: string): boolean {
  if (path.isAbsolute(pattern) || /^[A-Za-z]:/.test(pattern)) return false;
  return !pattern.split(/[\\/]+/).includes('..');
}

async function workspacePatterns(
  root: string,
  packageJson: Record<string, unknown> | undefined,
  hasTurbo: boolean,
): Promise<string[]> {
  const patterns: string[] = [];

  const pnpmYaml = await readText(root, 'pnpm-workspace.yaml');
  if (pnpmYaml) {
    let inPackages = false;
    for (const line of pnpmYaml.split(/\r?\n/)) {
      if (/^packages\s*:/.test(line)) {
        const flow = /^packages\s*:\s*\[(.*)\]\s*(#.*)?$/.exec(line);
        if (flow) {
          for (const part of flow[1].split(',')) {
            const value = part.trim().replace(/^['"]|['"]$/g, '').trim();
            if (value) patterns.push(value);
          }
        } else {
          inPackages = true;
        }
        continue;
      }
      if (inPackages) {
        const item = /^\s*-\s*['"]?([^'"#]+?)['"]?\s*(#.*)?$/.exec(line);
        if (item) patterns.push(item[1]);
        else if (/^\s*(#.*)?$/.test(line)) continue;
        else if (/^\S/.test(line)) inPackages = false;
      }
    }
  }

  const declared = packageJson?.workspaces;
  const list = Array.isArray(declared)
    ? declared
    : declared && typeof declared === 'object' && Array.isArray((declared as { packages?: unknown }).packages)
      ? (declared as { packages: unknown[] }).packages
      : [];
  for (const entry of list) if (typeof entry === 'string') patterns.push(entry);

  if (patterns.length === 0 && hasTurbo) patterns.push('packages/*', 'apps/*');

  return patterns.filter((pattern) => insideRoot(pattern.replace(/^!/, '')));
}

function segmentRegExp(segment: string): RegExp {
  const escaped = segment.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*+/g, '[^/]*');
  return new RegExp(`^${escaped}$`);
}

async function expandWorkspacePattern(root: string, pattern: string): Promise<string[]> {
  const clean = pattern.replace(/^\.\//, '').replace(/\/+$/, '');
  if (!clean || clean.startsWith('!') || !insideRoot(clean)) return [];
  const segments = clean.split('/').filter((segment) => segment && segment !== '.');
  let current: string[] = [''];
  for (const segment of segments) {
    const next: string[] = [];
    for (const base of current) {
      if (!segment.includes('*')) {
        next.push(base ? `${base}/${segment}` : segment);
        continue;
      }
      const baseDir = path.join(root, base);
      if (!(await fs.pathExists(baseDir))) continue;
      const matcher = segmentRegExp(segment);
      const entries = await fs.readdir(baseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        if (matcher.test(entry.name)) next.push(base ? `${base}/${entry.name}` : entry.name);
      }
    }
    current = next;
  }
  return current.sort();
}

async function detectWorkspaces(
  root: string,
  packageJson: Record<string, unknown> | undefined,
  packageManager: PackageManager,
  hasTurbo: boolean,
): Promise<{ workspaces: Workspace[]; total: number }> {
  const patterns = await workspacePatterns(root, packageJson, hasTurbo);
  if (patterns.length === 0) return { workspaces: [], total: 0 };
  const excluded = new Set<string>();
  for (const pattern of patterns) {
    if (pattern.startsWith('!')) {
      for (const dir of await expandWorkspacePattern(root, pattern.slice(1))) excluded.add(dir);
    }
  }

  const seen = new Set<string>();
  const workspaces: Workspace[] = [];
  for (const pattern of patterns) {
    for (const dir of await expandWorkspacePattern(root, pattern)) {
      if (seen.has(dir) || excluded.has(dir)) continue;
      seen.add(dir);
      const pkg = await readPackageJsonSafe(path.join(root, dir));
      if (!pkg) continue;
      const name = typeof pkg.name === 'string' && pkg.name ? pkg.name : path.basename(dir);
      if (!SAFE_PACKAGE_NAME.test(name)) continue;
      const scripts = detectScripts(pkg);
      const commandFor = (names: string[]): string | undefined => {
        const script = names.find((candidate) => candidate in scripts);
        return script ? workspaceScriptCommand(packageManager, name, script) : undefined;
      };
      const commands: WorkspaceCommands = {};
      const test = commandFor(['test', 'test:unit']);
      const build = commandFor(['build']);
      const lint = commandFor(['lint', 'eslint']);
      const typecheck = commandFor(['typecheck', 'type-check', 'tsc']);
      if (test) commands.test = test;
      if (build) commands.build = build;
      if (lint) commands.lint = lint;
      if (typecheck) commands.typecheck = typecheck;
      workspaces.push({ name, path: dir, commands });
    }
  }
  workspaces.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { workspaces: workspaces.slice(0, MAX_WORKSPACES), total: workspaces.length };
}

export async function detectProject(root = process.cwd()): Promise<ProjectDetection> {
  const packageJson = await readPackageJson(root);
  const scripts = detectScripts(packageJson);
  const packageManager = await detectPackageManager(root, packageJson);
  const stacks = new Set<StackName>(detectStackFromPackageJson(packageJson));

  const hasTsconfig = await exists(root, 'tsconfig.json');
  const deps = allDeps(packageJson);
  if (packageJson && stacks.size === 0) stacks.add('Node');
  if (packageJson && (hasTsconfig || 'typescript' in deps)) stacks.add('TypeScript');

  let hasEslintConfig = 'eslint' in deps;
  for (const config of ESLINT_CONFIGS) {
    if (!hasEslintConfig && (await exists(root, config))) hasEslintConfig = true;
  }

  const testRunner = detectTestRunner(packageJson, scripts);
  const exec = execPrefix(packageManager);
  const lint =
    commandForScript(scripts, packageManager, ['lint', 'eslint']) ??
    (hasEslintConfig ? `${exec} eslint .` : undefined);
  const typecheck =
    commandForScript(scripts, packageManager, ['typecheck', 'type-check', 'tsc']) ??
    (hasTsconfig ? `${exec} tsc --noEmit` : undefined);

  if ((await exists(root, 'prisma/schema.prisma')) || (await exists(root, 'prisma'))) {
    stacks.add('Prisma');
  }

  if (
    (await exists(root, 'requirements.txt')) ||
    (await exists(root, 'pyproject.toml')) ||
    (await exists(root, 'Pipfile')) ||
    (await exists(root, 'poetry.lock'))
  ) {
    stacks.add('Python');
  }
  if (await exists(root, 'go.mod')) stacks.add('Go');
  if (await exists(root, 'Cargo.toml')) stacks.add('Rust');

  // Non-Node language detection only applies when there is no package.json.
  const language = packageJson
    ? undefined
    : ((await detectGo(root)) ?? (await detectRust(root)) ?? (await detectPython(root)));

  if (
    (await exists(root, 'Dockerfile')) ||
    (await exists(root, 'docker-compose.yml')) ||
    (await exists(root, 'docker-compose.yaml')) ||
    (await exists(root, 'compose.yml')) ||
    (await exists(root, 'compose.yaml'))
  ) {
    stacks.add('Docker');
  }

  if (language) {
    return {
      root,
      packageManager: language.packageManager,
      stacks: [...stacks],
      workspaces: [],
      scripts,
      commands: language.commands,
    };
  }

  const hasTurbo = await exists(root, 'turbo.json');
  const { workspaces, total: workspacesTotal } = await detectWorkspaces(
    root,
    packageJson,
    packageManager,
    hasTurbo,
  );
  const workspaceTool: ProjectDetection['workspaceTool'] | undefined = hasTurbo
    ? 'turbo'
    : workspaces.length > 0
      ? packageManager === 'pnpm' || packageManager === 'yarn'
        ? packageManager
        : 'npm'
      : undefined;

  return {
    root,
    packageManager,
    stacks: [...stacks],
    ...(testRunner ? { testRunner } : {}),
    workspaces,
    workspacesTotal,
    ...(workspaceTool ? { workspaceTool } : {}),
    scripts,
    commands: {
      install: installCommand(packageManager),
      dev: commandForScript(scripts, packageManager, ['dev', 'start']),
      build: commandForScript(scripts, packageManager, ['build']),
      test: commandForScript(scripts, packageManager, ['test', 'test:unit']),
      lint,
      typecheck,
    },
  };
}

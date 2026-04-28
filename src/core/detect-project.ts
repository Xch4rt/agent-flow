import path from 'node:path';
import fs from 'fs-extra';
import { z } from 'zod';

const PackageManagerSchema = z.enum(['pnpm', 'npm', 'yarn', 'bun', 'unknown']);
const StackNameSchema = z.enum([
  'Next.js',
  'NestJS',
  'Express',
  'Fastify',
  'Prisma',
  'Python',
  'Docker',
]);

export type PackageManager = z.infer<typeof PackageManagerSchema>;
export type StackName = z.infer<typeof StackNameSchema>;

export type ProjectDetection = {
  root: string;
  packageManager: PackageManager;
  stacks: StackName[];
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

async function detectPackageManager(root: string): Promise<PackageManager> {
  if (await exists(root, 'pnpm-lock.yaml')) return 'pnpm';
  if (await exists(root, 'package-lock.json')) return 'npm';
  if (await exists(root, 'yarn.lock')) return 'yarn';
  if (await exists(root, 'bun.lockb')) return 'bun';
  if (await exists(root, 'bun.lock')) return 'bun';
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

export async function detectProject(root = process.cwd()): Promise<ProjectDetection> {
  const packageJson = await readPackageJson(root);
  const scripts = detectScripts(packageJson);
  const packageManager = await detectPackageManager(root);
  const stacks = new Set<StackName>(detectStackFromPackageJson(packageJson));

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

  if (
    (await exists(root, 'Dockerfile')) ||
    (await exists(root, 'docker-compose.yml')) ||
    (await exists(root, 'docker-compose.yaml')) ||
    (await exists(root, 'compose.yml')) ||
    (await exists(root, 'compose.yaml'))
  ) {
    stacks.add('Docker');
  }

  return {
    root,
    packageManager,
    stacks: [...stacks],
    scripts,
    commands: {
      install: installCommand(packageManager),
      dev: commandForScript(scripts, packageManager, ['dev', 'start']),
      build: commandForScript(scripts, packageManager, ['build']),
      test: commandForScript(scripts, packageManager, ['test', 'test:unit']),
      lint: commandForScript(scripts, packageManager, ['lint']),
      typecheck: commandForScript(scripts, packageManager, ['typecheck', 'type-check']),
    },
  };
}

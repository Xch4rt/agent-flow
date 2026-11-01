import path from 'node:path';
import os from 'node:os';
import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectProject } from '../src/core/detect-project.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-flow-detect-test-'));
});

afterEach(async () => {
  await fs.remove(tmpDir);
});

async function writePackageJson(dependencies: Record<string, string> = {}): Promise<void> {
  await fs.writeJson(path.join(tmpDir, 'package.json'), {
    scripts: {
      dev: 'dev-command',
      build: 'build-command',
      test: 'test-command',
      lint: 'lint-command',
      typecheck: 'typecheck-command',
    },
    dependencies,
  });
}

describe('project detection', () => {
  it.each([
    ['pnpm-lock.yaml', 'pnpm'],
    ['package-lock.json', 'npm'],
    ['yarn.lock', 'yarn'],
    ['bun.lock', 'bun'],
  ] as const)('detects %s as %s', async (lockfile, packageManager) => {
    await writePackageJson();
    await fs.writeFile(path.join(tmpDir, lockfile), '');

    await expect(detectProject(tmpDir)).resolves.toMatchObject({ packageManager });
  });

  it('detects package scripts as commands', async () => {
    await writePackageJson();
    await fs.writeFile(path.join(tmpDir, 'package-lock.json'), '');

    await expect(detectProject(tmpDir)).resolves.toMatchObject({
      commands: {
        install: 'npm install',
        dev: 'npm run dev',
        build: 'npm run build',
        test: 'npm run test',
        lint: 'npm run lint',
        typecheck: 'npm run typecheck',
      },
    });
  });

  it.each([
    ['next', 'Next.js'],
    ['@nestjs/core', 'NestJS'],
    ['express', 'Express'],
    ['fastify', 'Fastify'],
    ['prisma', 'Prisma'],
  ] as const)('detects %s dependency as %s', async (dependency, stack) => {
    await writePackageJson({ [dependency]: '^1.0.0' });

    const detection = await detectProject(tmpDir);

    expect(detection.stacks).toContain(stack);
  });

  it('detects Prisma from a prisma directory', async () => {
    await fs.ensureDir(path.join(tmpDir, 'prisma'));

    await expect(detectProject(tmpDir)).resolves.toMatchObject({
      stacks: ['Prisma'],
    });
  });

  it('detects Python project files', async () => {
    await fs.writeFile(path.join(tmpDir, 'pyproject.toml'), '');

    const detection = await detectProject(tmpDir);

    expect(detection.stacks).toContain('Python');
  });

  it('detects Docker files', async () => {
    await fs.writeFile(path.join(tmpDir, 'Dockerfile'), '');

    const detection = await detectProject(tmpDir);

    expect(detection.stacks).toContain('Docker');
  });

  async function writeRaw(pkg: Record<string, unknown>): Promise<void> {
    await fs.writeJson(path.join(tmpDir, 'package.json'), pkg);
  }

  it('detects plain Node and TypeScript', async () => {
    await writeRaw({ name: 'x' });
    expect((await detectProject(tmpDir)).stacks).toEqual(['Node']);

    await fs.writeFile(path.join(tmpDir, 'tsconfig.json'), '{}');
    expect((await detectProject(tmpDir)).stacks).toEqual(['Node', 'TypeScript']);
  });

  it('detects TypeScript from the typescript dependency', async () => {
    await writeRaw({ devDependencies: { typescript: '^5' } });
    expect((await detectProject(tmpDir)).stacks).toEqual(['Node', 'TypeScript']);
  });

  it.each([
    [{ devDependencies: { vitest: '1' } }, 'vitest'],
    [{ devDependencies: { jest: '1' } }, 'jest'],
    [{ devDependencies: { mocha: '1' } }, 'mocha'],
    [{ scripts: { test: 'node --test test/' } }, 'node:test'],
    [{ scripts: { test: 'vitest run' } }, 'vitest'],
  ] as const)('detects test runner %j as %s', async (pkg, runner) => {
    await writeRaw(pkg);
    expect((await detectProject(tmpDir)).testRunner).toBe(runner);
  });

  it('detects lint and typecheck from alternate scripts', async () => {
    await writeRaw({ scripts: { eslint: 'eslint .', 'type-check': 'tsc' } });
    await fs.writeFile(path.join(tmpDir, 'package-lock.json'), '');
    expect((await detectProject(tmpDir)).commands).toMatchObject({
      lint: 'npm run eslint',
      typecheck: 'npm run type-check',
    });
    await writeRaw({ scripts: { tsc: 'tsc --noEmit' } });
    expect((await detectProject(tmpDir)).commands.typecheck).toBe('npm run tsc');
  });

  it('falls back to eslint and tsconfig presence without scripts', async () => {
    await writeRaw({ name: 'x' });
    await fs.writeFile(path.join(tmpDir, 'pnpm-lock.yaml'), '');
    await fs.writeFile(path.join(tmpDir, 'eslint.config.js'), '');
    await fs.writeFile(path.join(tmpDir, 'tsconfig.json'), '{}');
    expect((await detectProject(tmpDir)).commands).toMatchObject({
      lint: 'pnpm exec eslint .',
      typecheck: 'pnpm exec tsc --noEmit',
    });
  });

  it('falls back to packageManager field, then npm', async () => {
    await writeRaw({ packageManager: 'pnpm@9.0.0' });
    expect((await detectProject(tmpDir)).packageManager).toBe('pnpm');
    await writeRaw({ name: 'x' });
    expect((await detectProject(tmpDir)).packageManager).toBe('npm');
  });
});

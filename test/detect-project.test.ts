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
});

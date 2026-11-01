import path from 'node:path';
import os from 'node:os';
import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveGateCommands } from '../src/core/gates.js';
import { detectProject } from '../src/core/detect-project.js';

let tmpDir: string;
let outsideDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-flow-detect-test-'));
  outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-flow-detect-outside-'));
});

afterEach(async () => {
  await fs.remove(tmpDir);
  await fs.remove(outsideDir);
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

describe('non-Node language detection', () => {
  it('detects Python with uv, pytest and ruff', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'pyproject.toml'),
      '[project]\nname="x"\n[tool.ruff]\nline-length=100\n[dependency-groups]\ndev=["pytest"]\n',
    );
    await fs.writeFile(path.join(tmpDir, 'uv.lock'), '');
    const d = await detectProject(tmpDir);
    expect(d.stacks).toContain('Python');
    expect(d.packageManager).toBe('uv');
    expect(d.commands.test).toBe('uv run pytest');
    expect(d.commands.lint).toBe('uv run ruff check .');
  });

  it('detects Python with poetry and flake8', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'pyproject.toml'),
      '[tool.poetry]\nname="x"\n[tool.poetry.dev-dependencies]\npytest="*"\nflake8="*"\n',
    );
    const d = await detectProject(tmpDir);
    expect(d.packageManager).toBe('poetry');
    expect(d.commands.test).toBe('poetry run pytest');
    expect(d.commands.lint).toBe('poetry run flake8');
  });

  it('detects Python with pip from requirements.txt', async () => {
    await fs.writeFile(path.join(tmpDir, 'requirements.txt'), 'pytest\nruff\n');
    const d = await detectProject(tmpDir);
    expect(d.packageManager).toBe('pip');
    expect(d.commands.test).toBe('pytest');
    expect(d.commands.lint).toBe('ruff check .');
    expect(d.commands.install).toBe('pip install -r requirements.txt');
  });

  it('detects Go', async () => {
    await fs.writeFile(path.join(tmpDir, 'go.mod'), 'module x\n\ngo 1.22\n');
    const d = await detectProject(tmpDir);
    expect(d.stacks).toContain('Go');
    expect(d.commands.test).toBe('go test ./...');
    expect(d.commands.lint).toBe('go vet ./...');
    expect(d.commands.build).toBe('go build ./...');
  });

  it('detects Rust', async () => {
    await fs.writeFile(path.join(tmpDir, 'Cargo.toml'), '[package]\nname="x"\n');
    const d = await detectProject(tmpDir);
    expect(d.stacks).toContain('Rust');
    expect(d.commands.test).toBe('cargo test');
    expect(d.commands.lint).toBe('cargo clippy');
    expect(d.commands.build).toBe('cargo build');
  });

  it('gate resolution falls back to detected commands for Go and Rust', async () => {
    await fs.writeFile(path.join(tmpDir, 'go.mod'), 'module x\n');
    expect(await resolveGateCommands(tmpDir)).toMatchObject({
      test: 'go test ./...',
      lint: 'go vet ./...',
      build: 'go build ./...',
    });
    await fs.remove(path.join(tmpDir, 'go.mod'));
    await fs.writeFile(path.join(tmpDir, 'Cargo.toml'), '[package]\nname="x"\n');
    expect(await resolveGateCommands(tmpDir)).toMatchObject({ test: 'cargo test', build: 'cargo build' });
  });
});

describe('monorepo workspaces', () => {
  async function writePackage(dir: string, name: string, scripts: Record<string, string>): Promise<void> {
    await fs.ensureDir(path.join(tmpDir, dir));
    await fs.writeJson(path.join(tmpDir, dir, 'package.json'), { name, scripts });
  }

  it('lists pnpm-workspace.yaml packages with their own commands', async () => {
    await fs.writeFile(path.join(tmpDir, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n  - '!packages/skip'\n  - apps/web\n");
    await fs.writeFile(path.join(tmpDir, 'pnpm-lock.yaml'), '');
    await fs.writeJson(path.join(tmpDir, 'package.json'), { name: 'root', scripts: { test: 'turbo test' } });
    await fs.writeJson(path.join(tmpDir, 'turbo.json'), { tasks: {} });
    await writePackage('packages/core', '@acme/core', { test: 'vitest', build: 'tsc', typecheck: 'tsc --noEmit' });
    await writePackage('packages/skip', '@acme/skip', { test: 'x' });
    await writePackage('apps/web', '@acme/web', { lint: 'eslint .' });

    const { workspaces } = await detectProject(tmpDir);

    expect(workspaces).toEqual([
      { name: '@acme/web', path: 'apps/web', commands: { lint: 'pnpm --filter @acme/web lint' } },
      {
        name: '@acme/core',
        path: 'packages/core',
        commands: {
          test: 'pnpm --filter @acme/core test',
          build: 'pnpm --filter @acme/core build',
          typecheck: 'pnpm --filter @acme/core typecheck',
        },
      },
    ]);
  });

  it('reads package.json workspaces arrays and objects', async () => {
    await fs.writeJson(path.join(tmpDir, 'package.json'), { name: 'root', workspaces: { packages: ['libs/*'] } });
    await writePackage('libs/a', 'a', { test: 'jest' });

    const { workspaces } = await detectProject(tmpDir);

    expect(workspaces).toEqual([
      { name: 'a', path: 'libs/a', commands: { test: 'npm run test --workspace a' } },
    ]);
  });

  it('finds packages from turbo.json alone and reports turbo', async () => {
    await fs.writeJson(path.join(tmpDir, 'turbo.json'), { tasks: {} });
    await writePackage('packages/a', 'a', { test: 'vitest' });
    await writePackage('apps/b', 'b', { build: 'tsc' });

    const detection = await detectProject(tmpDir);

    expect(detection.workspaceTool).toBe('turbo');
    expect(detection.workspaces?.map((w) => w.path)).toEqual(['apps/b', 'packages/a']);
  });

  it('skips packages with malformed package.json without throwing', async () => {
    await fs.writeJson(path.join(tmpDir, 'package.json'), { name: 'root', workspaces: ['packages/*'] });
    await writePackage('packages/ok', 'ok', { test: 'vitest' });
    await fs.ensureDir(path.join(tmpDir, 'packages/bad'));
    await fs.writeFile(path.join(tmpDir, 'packages/bad/package.json'), '{ not json');

    const { workspaces } = await detectProject(tmpDir);

    expect(workspaces?.map((w) => w.name)).toEqual(['ok']);
  });

  it('ignores patterns outside the root and unsafe package names', async () => {
    await fs.writeJson(path.join(tmpDir, 'package.json'), {
      name: 'root',
      workspaces: [`../${path.basename(outsideDir)}/*`, '/etc/*', 'packages/*'],
    });
    await fs.ensureDir(path.join(outsideDir, 'x'));
    await fs.writeJson(path.join(outsideDir, 'x/package.json'), { name: 'leak' });
    await writePackage('packages/evil', 'x; rm -rf ~', { test: 'vitest' });
    await writePackage('packages/good', 'good', { test: 'vitest' });

    const { workspaces } = await detectProject(tmpDir);

    expect(workspaces?.map((w) => w.name)).toEqual(['good']);
  });

  it('returns no workspaces for a plain project', async () => {
    await writePackageJson();
    expect((await detectProject(tmpDir)).workspaces).toEqual([]);
  });

  it('skips package names starting with a dash', async () => {
    await fs.writeJson(path.join(tmpDir, 'package.json'), { name: 'root', workspaces: ['packages/*'] });
    await writePackage('packages/flag', '-rf', { test: 'vitest' });
    await writePackage('packages/good', 'good', { test: 'vitest' });

    const { workspaces } = await detectProject(tmpDir);

    expect(workspaces?.map((w) => w.name)).toEqual(['good']);
  });

  it('caps workspaces at 25 and reports the total', async () => {
    await fs.writeJson(path.join(tmpDir, 'package.json'), { name: 'root', workspaces: ['packages/*'] });
    for (let i = 0; i < 30; i += 1) await writePackage(`packages/p${String(i).padStart(2, '0')}`, `p${i}`, { test: 'vitest' });

    const detection = await detectProject(tmpDir);

    expect(detection.workspaces).toHaveLength(25);
    expect(detection.workspacesTotal).toBe(30);
    expect(detection.workspaces?.[0].path).toBe('packages/p00');
    expect(detection.workspaces?.[24].path).toBe('packages/p24');
  });

  it('keeps reading pnpm packages past a column-0 comment', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'pnpm-workspace.yaml'),
      "packages:\n  - 'libs/a'\n# a comment\n  - 'libs/b'\n",
    );
    await writePackage('libs/a', 'a', {});
    await writePackage('libs/b', 'b', {});

    expect((await detectProject(tmpDir)).workspaces?.map((w) => w.name)).toEqual(['a', 'b']);
  });

  it('parses flow-style pnpm package lists', async () => {
    await writePackage('libs/a', 'a', {});
    await writePackage('libs/b', 'b', {});
    await fs.writeFile(path.join(tmpDir, 'pnpm-workspace.yaml'), "packages: ['libs/a', 'libs/b']\n");
    expect((await detectProject(tmpDir)).workspaces?.map((w) => w.name)).toEqual(['a', 'b']);
    await fs.writeFile(path.join(tmpDir, 'pnpm-workspace.yaml'), 'packages: ["libs/a"]\n');
    expect((await detectProject(tmpDir)).workspaces?.map((w) => w.name)).toEqual(['a']);
  });

  it('expands partial globs per path segment', async () => {
    await fs.writeJson(path.join(tmpDir, 'package.json'), {
      name: 'root',
      workspaces: ['packages/core-*', 'apps/*/pkg'],
    });
    await writePackage('packages/core-a', 'core-a', {});
    await writePackage('packages/other', 'other', {});
    await writePackage('apps/web/pkg', 'web-pkg', {});
    await writePackage('apps/web/nope', 'nope', {});

    expect((await detectProject(tmpDir)).workspaces?.map((w) => w.name)).toEqual(['web-pkg', 'core-a']);
  });
});

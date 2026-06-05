import path from 'node:path';
import os from 'node:os';
import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findProjectRoot, resolveRoot } from '../src/core/project-root.js';
import { createProgram } from '../src/cli.js';
import { runInit } from '../src/commands/init.js';
import { writePlan, emptyPlan } from '../src/core/plan.js';

let tmpDir: string;
let originalCwd: string;

beforeEach(async () => {
  originalCwd = process.cwd();
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-flow-root-test-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  process.exitCode = 0;
});

afterEach(async () => {
  process.chdir(originalCwd);
  vi.restoreAllMocks();
  process.exitCode = 0;
  delete process.env.AGENT_FLOW_ROOT;
  await fs.remove(tmpDir);
});

describe('findProjectRoot', () => {
  it('finds the nearest ancestor with .agent-flow/config.json', async () => {
    await fs.ensureDir(path.join(tmpDir, '.agent-flow'));
    await fs.writeJson(path.join(tmpDir, '.agent-flow/config.json'), { schemaVersion: 1 });
    const sub = path.join(tmpDir, 'a', 'b', 'c');
    await fs.ensureDir(sub);
    expect(findProjectRoot(sub)).toBe(path.resolve(tmpDir));
  });

  it('returns null when no project is found', async () => {
    const lonely = path.join(tmpDir, 'nowhere');
    await fs.ensureDir(lonely);
    expect(findProjectRoot(lonely)).toBeNull();
  });
});

describe('resolveRoot precedence', () => {
  it('prefers the flag, then env, then discovery, then cwd', async () => {
    await fs.ensureDir(path.join(tmpDir, '.agent-flow'));
    await fs.writeJson(path.join(tmpDir, '.agent-flow/config.json'), { schemaVersion: 1 });

    expect(resolveRoot({ rootFlag: '/explicit', cwd: tmpDir })).toBe(path.resolve('/explicit'));
    expect(resolveRoot({ env: '/from-env', cwd: tmpDir })).toBe(path.resolve('/from-env'));
    expect(resolveRoot({ cwd: path.join(tmpDir, 'sub') })).toBe(path.resolve(tmpDir));

    const plain = path.join(tmpDir, 'plain');
    await fs.ensureDir(path.join(plain, 'x'));
    // .agent-flow at tmpDir is an ancestor, so discovery finds tmpDir, not `plain`.
    expect(resolveRoot({ cwd: path.join(plain, 'x') })).toBe(path.resolve(tmpDir));
  });
});

describe('--root flag end to end', () => {
  it('operates on the project at --root regardless of cwd', async () => {
    const project = path.join(tmpDir, 'proj');
    await fs.ensureDir(project);
    await runInit({ codex: true, cwd: project });
    await writePlan(project, {
      ...emptyPlan(new Date('2026-01-01T00:00:00.000Z')),
      phases: [{ id: '1', title: 'P1', goal: '', requirements: [], dependsOn: [], status: 'pending', tasks: [] }],
    });

    // Run from a different cwd, pointing --root at the project.
    const elsewhere = path.join(tmpDir, 'elsewhere');
    await fs.ensureDir(elsewhere);
    process.chdir(elsewhere);

    await createProgram().parseAsync(['node', 'agent-flow', '--root', project, 'plan', 'validate']);

    expect(process.exitCode).toBe(0);
    // The hook chdir'd into the project root.
    expect(await fs.realpath(process.cwd())).toBe(await fs.realpath(project));
  });
});

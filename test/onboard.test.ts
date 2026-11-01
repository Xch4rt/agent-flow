import path from 'node:path';
import os from 'node:os';
import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runInit } from '../src/commands/init.js';
import { runOnboard } from '../src/commands/onboard.js';
import { getOnboardingState, onboardEndMarker, onboardStartMarker } from '../src/core/onboard.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-flow-onboard-test-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.remove(tmpDir);
});

describe('onboard command', () => {
  it('creates generated sections without wiping custom content', async () => {
    await runInit({ codex: true, cwd: tmpDir });
    await fs.writeFile(path.join(tmpDir, '.planning/PROJECT.md'), '# Project\n\nCustom notes stay here.\n');

    await runOnboard({ cwd: tmpDir });

    const project = await fs.readFile(path.join(tmpDir, '.planning/PROJECT.md'), 'utf8');

    expect(project).toContain('Custom notes stay here.');
    expect(project).toContain(onboardStartMarker);
    expect(project).toContain(onboardEndMarker);
    expect(project).toContain('Agent Flow Onboarding');
  });

  it('dry-run does not modify planning or memory files', async () => {
    await runInit({ codex: true, cwd: tmpDir });
    const beforeProject = await fs.readFile(path.join(tmpDir, '.planning/PROJECT.md'), 'utf8');

    await runOnboard({ cwd: tmpDir, dryRun: true });

    await expect(fs.readFile(path.join(tmpDir, '.planning/PROJECT.md'), 'utf8')).resolves.toBe(beforeProject);
    await expect(fs.readFile(path.join(tmpDir, '.memory/events.jsonl'), 'utf8')).resolves.toBe('');
  });

  it('appends onboarding memory entries', async () => {
    await fs.ensureDir(path.join(tmpDir, 'src'));
    await runInit({ codex: true, cwd: tmpDir });

    await runOnboard({ cwd: tmpDir });

    const events = await fs.readFile(path.join(tmpDir, '.memory/events.jsonl'), 'utf8');
    const modules = await fs.readFile(path.join(tmpDir, '.memory/modules.jsonl'), 'utf8');

    expect(JSON.parse(events.trim())).toMatchObject({ type: 'onboard' });
    expect(JSON.parse(modules.trim())).toMatchObject({ type: 'module', module: 'src' });
  });

  it('does not duplicate onboarding memory repeatedly without refresh', async () => {
    await runInit({ codex: true, cwd: tmpDir });

    await runOnboard({ cwd: tmpDir });
    await runOnboard({ cwd: tmpDir });

    const eventLines = (await fs.readFile(path.join(tmpDir, '.memory/events.jsonl'), 'utf8')).trim().split('\n');

    expect(eventLines).toHaveLength(1);
  });

  it('refresh appends a new onboarding event without duplicating module entries', async () => {
    await fs.ensureDir(path.join(tmpDir, 'src'));
    await runInit({ codex: true, cwd: tmpDir });
    await runOnboard({ cwd: tmpDir });

    await runOnboard({ cwd: tmpDir, refresh: true });

    const eventLines = (await fs.readFile(path.join(tmpDir, '.memory/events.jsonl'), 'utf8')).trim().split('\n');
    const moduleLines = (await fs.readFile(path.join(tmpDir, '.memory/modules.jsonl'), 'utf8')).trim().split('\n');
    const state = await getOnboardingState(tmpDir);

    expect(eventLines).toHaveLength(2);
    expect(moduleLines).toHaveLength(1);
    expect(state.onboarded).toBe(true);
  });
});

describe('onboard workspaces and test runner', () => {
  it('writes the test runner and a Workspaces table to generated sections', async () => {
    await fs.writeJson(path.join(tmpDir, 'package.json'), {
      name: 'root',
      workspaces: ['packages/*'],
      devDependencies: { vitest: '^1.0.0' },
    });
    await fs.ensureDir(path.join(tmpDir, 'packages/core'));
    await fs.writeJson(path.join(tmpDir, 'packages/core/package.json'), { name: 'core', scripts: { test: 'vitest' } });
    await runInit({ codex: true, cwd: tmpDir });
    await runOnboard({ cwd: tmpDir });

    const project = await fs.readFile(path.join(tmpDir, '.planning/PROJECT.md'), 'utf8');
    const agents = await fs.readFile(path.join(tmpDir, 'AGENTS.md'), 'utf8');

    for (const text of [project, agents]) {
      expect(text).toContain('vitest');
      expect(text).toContain('Workspaces');
      expect(text).toContain('| core | `packages/core` |');
    }
    expect(agents).toContain('- Test runner: vitest');
  });

  it('prints the test runner line', async () => {
    await fs.writeJson(path.join(tmpDir, 'package.json'), { name: 'root', devDependencies: { vitest: '^1.0.0' } });
    await runInit({ codex: true, cwd: tmpDir });
    vi.mocked(console.log).mockClear();
    await runOnboard({ cwd: tmpDir });

    const lines = vi.mocked(console.log).mock.calls.map((call) => String(call[0]));
    expect(lines.find((line) => line.includes('Test runner:'))).toContain('vitest');
  });
});

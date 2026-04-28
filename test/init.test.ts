import path from 'node:path';
import os from 'node:os';
import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runInit } from '../src/commands/init.js';

let tmpDir: string;

const requiredFiles = [
  'AGENTS.md',
  '.agent-flow/config.json',
  '.planning/PROJECT.md',
  '.planning/REQUIREMENTS.md',
  '.planning/ROADMAP.md',
  '.planning/STATE.md',
  '.planning/DECISIONS.md',
  '.planning/OPEN_QUESTIONS.md',
  '.memory/events.jsonl',
  '.memory/decisions.jsonl',
  '.memory/errors.jsonl',
  '.memory/modules.jsonl',
  '.codex/skills/flow-onboard/SKILL.md',
  '.codex/skills/flow-resume/SKILL.md',
  '.codex/skills/flow-quick/SKILL.md',
  '.codex/skills/flow-plan/SKILL.md',
  '.codex/skills/flow-verify/SKILL.md',
  '.codex/skills/flow-close/SKILL.md',
];

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-flow-test-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.remove(tmpDir);
});

describe('init --codex', () => {
  it('creates the required agent-flow and Codex files', async () => {
    await fs.writeJson(path.join(tmpDir, 'package.json'), {
      scripts: {
        dev: 'next dev',
        build: 'next build',
        test: 'vitest run',
      },
      dependencies: {
        next: '^15.0.0',
      },
    });
    await fs.writeFile(path.join(tmpDir, 'pnpm-lock.yaml'), '');

    await runInit({ codex: true, cwd: tmpDir });

    for (const file of requiredFiles) {
      await expect(fs.pathExists(path.join(tmpDir, file)), file).resolves.toBe(true);
    }

    await expect(fs.readFile(path.join(tmpDir, 'AGENTS.md'), 'utf8')).resolves.toContain('pnpm dev');
    await expect(fs.readFile(path.join(tmpDir, '.planning/PROJECT.md'), 'utf8')).resolves.toContain('Next.js');
    await expect(fs.readJson(path.join(tmpDir, '.agent-flow/config.json'))).resolves.toMatchObject({
      agent: 'codex',
      packageManager: 'pnpm',
      detectedStack: ['Next.js'],
    });
  });

  it('does not overwrite existing files without --force', async () => {
    await fs.ensureDir(path.join(tmpDir, '.planning'));
    await fs.writeFile(path.join(tmpDir, 'AGENTS.md'), 'custom agents file');
    await fs.writeFile(path.join(tmpDir, '.planning/STATE.md'), 'custom state');

    await runInit({ codex: true, cwd: tmpDir });

    await expect(fs.readFile(path.join(tmpDir, 'AGENTS.md'), 'utf8')).resolves.toBe('custom agents file');
    await expect(fs.readFile(path.join(tmpDir, '.planning/STATE.md'), 'utf8')).resolves.toBe('custom state');
  });

  it('does not overwrite memory files without --force', async () => {
    await fs.ensureDir(path.join(tmpDir, '.memory'));
    await fs.writeFile(path.join(tmpDir, '.memory/events.jsonl'), '{"type":"event","summary":"keep me"}\n');

    await runInit({ codex: true, cwd: tmpDir });

    await expect(fs.readFile(path.join(tmpDir, '.memory/events.jsonl'), 'utf8')).resolves.toBe(
      '{"type":"event","summary":"keep me"}\n',
    );
  });

  it('overwrites existing files with --force', async () => {
    await fs.writeFile(path.join(tmpDir, 'AGENTS.md'), 'custom agents file');

    await runInit({ codex: true, force: true, cwd: tmpDir });

    const agents = await fs.readFile(path.join(tmpDir, 'AGENTS.md'), 'utf8');
    expect(agents).toContain('This repository is prepared for AI coding agents with agent-flow.');
    expect(agents).not.toBe('custom agents file');
  });

  it('does not overwrite memory files with --force alone', async () => {
    await fs.ensureDir(path.join(tmpDir, '.memory'));
    await fs.writeFile(path.join(tmpDir, '.memory/events.jsonl'), '{"type":"event","summary":"keep me"}\n');

    await runInit({ codex: true, force: true, cwd: tmpDir });

    await expect(fs.readFile(path.join(tmpDir, '.memory/events.jsonl'), 'utf8')).resolves.toBe(
      '{"type":"event","summary":"keep me"}\n',
    );
  });

  it('overwrites memory files only with --force-memory', async () => {
    await fs.ensureDir(path.join(tmpDir, '.memory'));
    await fs.writeFile(path.join(tmpDir, '.memory/events.jsonl'), '{"type":"event","summary":"delete me"}\n');

    await runInit({ codex: true, force: true, forceMemory: true, cwd: tmpDir });

    await expect(fs.readFile(path.join(tmpDir, '.memory/events.jsonl'), 'utf8')).resolves.toBe('');
  });
});

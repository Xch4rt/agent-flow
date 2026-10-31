import path from 'node:path';
import os from 'node:os';
import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runInit } from '../src/commands/init.js';
import { ensureGitignore, missingGitignoreEntries } from '../src/core/claude-settings.js';

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
  '.agents/skills/flow-onboard/SKILL.md',
  '.agents/skills/flow-onboard/agents/openai.yaml',
  '.agents/skills/flow-resume/SKILL.md',
  '.agents/skills/flow-quick/SKILL.md',
  '.agents/skills/flow-plan/SKILL.md',
  '.agents/skills/flow-harden/SKILL.md',
  '.agents/skills/flow-orchestrate/SKILL.md',
  '.agents/skills/flow-verify/SKILL.md',
  '.agents/skills/flow-close/SKILL.md',
  '.codex/agents/flow_executor_light.toml',
  '.codex/agents/flow_executor.toml',
  '.codex/agents/flow_executor_deep.toml',
  '.codex/agents/flow_reviewer.toml',
  '.codex/agents/flow_hardener.toml',
  '.codex/hooks.json',
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
    await expect(fs.readFile(path.join(tmpDir, 'AGENTS.md'), 'utf8')).resolves.toContain('agent-flow context <task>');
    await expect(fs.readFile(path.join(tmpDir, 'AGENTS.md'), 'utf8')).resolves.toContain('.agent-flow/memory.db');
    await expect(fs.readFile(path.join(tmpDir, 'AGENTS.md'), 'utf8')).resolves.toContain('Do not manually edit it.');
    await expect(fs.readFile(path.join(tmpDir, '.planning/PROJECT.md'), 'utf8')).resolves.toContain('Next.js');
    await expect(fs.readJson(path.join(tmpDir, '.agent-flow/config.json'))).resolves.toMatchObject({
      packageManager: 'pnpm',
      detectedStack: ['Next.js'],
      adapters: { codex: true, claude: false },
      orchestration: { review: { tier: 0 }, strictGates: false },
    });
  });

  it('seeds a neutral REQUIREMENTS.md template (not agent-flow describing itself)', async () => {
    await runInit({ codex: true, cwd: tmpDir });

    const requirements = await fs.readFile(path.join(tmpDir, '.planning/REQUIREMENTS.md'), 'utf8');
    // Neutral: must not contain agent-flow's own product spec.
    expect(requirements).not.toContain('Codex-first');
    expect(requirements).not.toContain('JSONL');
    // Instructive: teaches the requirement-id format the orchestration flow consumes.
    expect(requirements).toContain('<CATEGORY>-<number>');
    expect(requirements).toContain('plan init');
    expect(requirements).toContain('plan validate');
    // Scaffold-safe: placeholder example ids collapse to a single obvious draft group.
    const ids = new Set([...requirements.matchAll(/\b[A-Z][A-Z0-9]*-\d+\b/g)].map((m) => m[0].split('-')[0]));
    expect([...ids]).toEqual(['CORE']);
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

  it('reports .gitignore as appended (never overwritten) and skipped when nothing is missing', async () => {
    await fs.writeFile(path.join(tmpDir, '.gitignore'), 'node_modules\n');
    expect((await ensureGitignore(tmpDir)).status).toBe('appended');
    expect((await ensureGitignore(tmpDir)).status).toBe('skipped');
    await fs.remove(path.join(tmpDir, '.gitignore'));
    expect((await ensureGitignore(tmpDir)).status).toBe('created');
  });

  it('prints the appended .gitignore line in init output', async () => {
    await fs.ensureDir(path.join(tmpDir, '.git'));
    await fs.writeFile(path.join(tmpDir, '.gitignore'), 'node_modules\n');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await runInit({ claude: true, cwd: tmpDir });
      const lines = log.mock.calls.map((args) => args.map(String).join(' '));
      expect(lines.some((line) => line.includes('appended') && line.includes('.gitignore'))).toBe(true);
    } finally {
      log.mockRestore();
    }
  });

  it('ignores .claude/settings.local.json and the doctor gitignore check accepts the entry set', async () => {
    await fs.ensureDir(path.join(tmpDir, '.git'));
    await runInit({ claude: true, cwd: tmpDir });
    const gitignore = await fs.readFile(path.join(tmpDir, '.gitignore'), 'utf8');
    expect(gitignore).toContain('.claude/settings.local.json');
    expect(gitignore).toContain('.agent-flow/memory.db');
    expect(await missingGitignoreEntries(tmpDir)).toEqual([]);
  });
});

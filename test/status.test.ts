import path from 'node:path';
import os from 'node:os';
import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runInit } from '../src/commands/init.js';
import { runStatus } from '../src/commands/status.js';
import { appendMemoryEntry } from '../src/core/jsonl-memory.js';
import { runOnboard } from '../src/commands/onboard.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-flow-status-test-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.remove(tmpDir);
});

describe('status command', () => {
  it('reports commands, skills, memory counts, mtimes, and warnings', async () => {
    await fs.writeJson(path.join(tmpDir, 'package.json'), {
      scripts: {
        dev: 'next dev',
        build: 'next build',
        test: 'vitest run',
        lint: 'eslint .',
        typecheck: 'tsc --noEmit',
      },
      dependencies: {
        next: '^15.0.0',
      },
    });
    await fs.writeFile(path.join(tmpDir, 'pnpm-lock.yaml'), '');
    await runInit({ codex: true, cwd: tmpDir });
    await appendMemoryEntry(tmpDir, 'modules', {
      type: 'module',
      summary: 'App router owns pages.',
      module: 'app',
    });

    vi.mocked(console.log).mockClear();
    await runStatus({ cwd: tmpDir });

    const output = vi.mocked(console.log).mock.calls.map((call) => String(call[0])).join('\n');

    expect(output).toContain('Package manager: pnpm');
    expect(output).toContain('Detected stack: Next.js');
    expect(output).toContain('Detected commands:');
    expect(output).toContain('dev: pnpm dev');
    expect(output).toContain('Missing Codex skills: 0');
    expect(output).toContain('Invalid memory entries: 0');
    expect(output).toContain('Context pack memory: limited');
    expect(output).toContain('Onboarded: no');
    expect(output).toContain('.memory/modules.jsonl: 1 entries');
    expect(output).toContain('Planning state modified:');
    expect(output).toContain('empty .memory/events.jsonl');
    expect(output).toContain('project is likely not onboarded');
  });

  it('reports onboarded yes after deterministic onboard', async () => {
    await runInit({ codex: true, cwd: tmpDir });
    await runOnboard({ cwd: tmpDir });

    vi.mocked(console.log).mockClear();
    await runStatus({ cwd: tmpDir });

    const output = vi.mocked(console.log).mock.calls.map((call) => String(call[0])).join('\n');

    expect(output).toContain('Onboarded: yes');
    expect(output).toContain('Last onboarded:');
    expect(output).not.toContain('project is likely not onboarded');
  });

  it('reports invalid memory entry counts', async () => {
    await runInit({ codex: true, cwd: tmpDir });
    await fs.writeFile(path.join(tmpDir, '.memory/modules.jsonl'), JSON.stringify({
      createdAt: '2026-01-01T00:00:00.000Z',
      type: 'module',
      summary: 'Missing required module name.',
    }) + '\n');

    vi.mocked(console.log).mockClear();
    await runStatus({ cwd: tmpDir });

    const output = vi.mocked(console.log).mock.calls.map((call) => String(call[0])).join('\n');

    expect(output).toContain('Invalid memory entries: 1');
    expect(output).toContain('invalid memory entries: 1');
  });
});

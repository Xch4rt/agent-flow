import path from 'node:path';
import os from 'node:os';
import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runInit } from '../src/commands/init.js';
import { runStatus } from '../src/commands/status.js';
import { appendMemoryEntry } from '../src/core/jsonl-memory.js';

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
    });

    vi.mocked(console.log).mockClear();
    await runStatus({ cwd: tmpDir });

    const output = vi.mocked(console.log).mock.calls.map((call) => String(call[0])).join('\n');

    expect(output).toContain('Package manager: pnpm');
    expect(output).toContain('Detected stack: Next.js');
    expect(output).toContain('Detected commands:');
    expect(output).toContain('dev: pnpm dev');
    expect(output).toContain('Missing Codex skills: 0');
    expect(output).toContain('.memory/modules.jsonl: 1 entries');
    expect(output).toContain('Planning state modified:');
    expect(output).toContain('empty .memory/events.jsonl');
    expect(output).toContain('project is likely not onboarded');
  });
});

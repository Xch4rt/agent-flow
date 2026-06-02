import path from 'node:path';
import os from 'node:os';
import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runStart } from '../src/commands/start.js';
import { createProgram } from '../src/cli.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-flow-start-test-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.remove(tmpDir);
});

function output(): string {
  return vi.mocked(console.log).mock.calls.map((call) => String(call[0])).join('\n');
}

describe('start command', () => {
  it('is registered in the CLI', () => {
    const cmd = createProgram().commands.find((c) => c.name() === 'start');
    expect(cmd).toBeDefined();
    expect(cmd?.helpInformation()).toContain('--module');
    expect(cmd?.helpInformation()).toContain('--stats');
    expect(cmd?.helpInformation()).toContain('--json');
  });

  it('warns when not initialized', async () => {
    await runStart('fix billing', { cwd: tmpDir });
    const out = output();
    expect(out).toContain('not initialized');
    expect(out).toContain('agent-flow init --codex');
  });

  it('warns when not onboarded', async () => {
    await fs.ensureDir(path.join(tmpDir, '.agent-flow'));
    await fs.writeJson(path.join(tmpDir, '.agent-flow/config.json'), {});

    await runStart('fix billing', { cwd: tmpDir });
    const out = output();
    expect(out).toContain('not onboarded');
    expect(out).toContain('agent-flow onboard');
  });

  it('prints context pack and next actions', async () => {
    await fs.ensureDir(path.join(tmpDir, '.planning'));
    await fs.writeFile(path.join(tmpDir, '.planning/STATE.md'), '# State\n\n## Current Status\n\nActive.\n');
    await fs.writeJson(path.join(tmpDir, 'package.json'), { scripts: { test: 'vitest run' } });

    await runStart('fix billing webhook', { cwd: tmpDir });
    const out = output();
    expect(out).toContain('Agent Flow Start');
    expect(out).toContain('fix billing webhook');
    expect(out).toContain('$flow-quick');
    expect(out).toContain('$flow-plan');
    expect(out).toContain('$flow-verify');
    expect(out).toContain('agent-flow close');
  });

  it('supports --json output', async () => {
    await runStart('test task', { cwd: tmpDir, json: true });
    const out = output();
    const parsed = JSON.parse(out);
    expect(parsed.task).toBe('test task');
    expect(parsed.warnings).toEqual(expect.arrayContaining([expect.stringContaining('not initialized')]));
  });
});

import path from 'node:path';
import os from 'node:os';
import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { codexSkillFiles, runDoctor } from '../src/commands/doctor.js';
import { runInit } from '../src/commands/init.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-flow-doctor-test-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  process.exitCode = undefined;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.remove(tmpDir);
  process.exitCode = undefined;
});

describe('doctor checks', () => {
  it('covers all six Codex skills', () => {
    expect(codexSkillFiles).toEqual([
      '.codex/skills/flow-onboard/SKILL.md',
      '.codex/skills/flow-resume/SKILL.md',
      '.codex/skills/flow-quick/SKILL.md',
      '.codex/skills/flow-plan/SKILL.md',
      '.codex/skills/flow-verify/SKILL.md',
      '.codex/skills/flow-close/SKILL.md',
    ]);
  });

  it('reports all expected checks in an initialized repo', async () => {
    await runInit({ codex: true, cwd: tmpDir });

    vi.mocked(console.log).mockClear();
    await runDoctor({ cwd: tmpDir });

    const output = vi.mocked(console.log).mock.calls.map((call) => String(call[0])).join('\n');

    expect(output).toContain('AGENTS.md');
    expect(output).toContain('.agent-flow/config.json');
    expect(output).toContain('.planning/PROJECT.md');
    expect(output).toContain('.memory/events.jsonl');
    expect(output).toContain('.codex/skills/flow-close/SKILL.md');
    expect(output).toContain('memory JSONL parseability');
    expect(process.exitCode).toBeUndefined();
  });
});

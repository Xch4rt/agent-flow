import path from 'node:path';
import os from 'node:os';
import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runInit } from '../src/commands/init.js';
import { runDoctor } from '../src/commands/doctor.js';
import { runPlanInit, runPlanRender } from '../src/commands/plan.js';
import { runNext, runGateCommand } from '../src/commands/orchestrate.js';
import {
  emptyPlan,
  loadPlan,
  renderRoadmap,
  scaffoldPlanFromRequirements,
  writePlan,
} from '../src/core/plan.js';
import type { Plan } from '../src/core/plan-schema.js';

let tmpDir: string;

async function setOrchestration(root: string, orchestration: Record<string, unknown>): Promise<void> {
  const configPath = path.join(root, '.agent-flow', 'config.json');
  const config = await fs.readJson(configPath);
  config.orchestration = orchestration;
  await fs.writeJson(configPath, config, { spaces: 2 });
}

function onePending(): Plan {
  return {
    ...emptyPlan(new Date('2026-01-01T00:00:00.000Z')),
    phases: [
      { id: '1', title: 'P1', goal: 'g', requirements: [], dependsOn: [], status: 'pending', tasks: [
        { id: '1.1', title: 'first', scope: [], wave: 1, dependsOn: [], status: 'pending', gates: ['ghost'], acceptance: [{ id: 'ac1', text: 'works', proof: 'test' }] },
      ] },
    ],
  };
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-flow-polish-test-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  process.exitCode = 0;
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  await fs.remove(tmpDir);
});

describe('renderRoadmap', () => {
  it('renders phases, task checkboxes, and progress', () => {
    const plan: Plan = {
      ...emptyPlan(new Date('2026-01-01T00:00:00.000Z')),
      phases: [
        { id: '1', title: 'Core', goal: 'do it', requirements: ['SHORT-01'], dependsOn: [], status: 'active', tasks: [
          { id: '1.1', title: 'a', scope: [], wave: 1, dependsOn: [], status: 'done', gates: [], acceptance: [] },
          { id: '1.2', title: 'b', scope: [], wave: 2, dependsOn: ['1.1'], status: 'pending', gates: [], acceptance: [] },
        ] },
      ],
    };
    const md = renderRoadmap(plan);
    expect(md).toContain('## Phase 1: Core — active');
    expect(md).toContain('- [x] 1.1');
    expect(md).toContain('- [ ] 1.2');
    expect(md).toContain('1/2 tasks (50%)');
    expect(md).toContain('Generated from');
  });
});

describe('scaffoldPlanFromRequirements', () => {
  it('groups requirements by prefix into draft phases', () => {
    const plan = scaffoldPlanFromRequirements(['SHORT-01', 'SHORT-02', 'REDIR-01']);
    expect(plan.phases).toHaveLength(2);
    const short = plan.phases.find((p) => p.requirements.includes('SHORT-01'));
    expect(short?.requirements).toEqual(['SHORT-01', 'SHORT-02']);
    expect(short?.tasks).toHaveLength(1);
  });
});

describe('plan render command', () => {
  it('writes .planning/ROADMAP.md from plan.json', async () => {
    await runInit({ codex: true, cwd: tmpDir });
    await writePlan(tmpDir, onePending());
    await runPlanRender({ cwd: tmpDir });
    const roadmap = await fs.readFile(path.join(tmpDir, '.planning/ROADMAP.md'), 'utf8');
    expect(roadmap).toContain('## Phase 1: P1');
  });
});

describe('plan init --scaffold', () => {
  it('seeds draft phases from REQUIREMENTS.md', async () => {
    await runInit({ codex: true, cwd: tmpDir });
    await fs.writeFile(path.join(tmpDir, '.planning/REQUIREMENTS.md'), '- SHORT-01: a\n- REDIR-01: b\n');
    await runPlanInit({ cwd: tmpDir, scaffold: true });
    const loaded = await loadPlan(tmpDir);
    if (loaded.exists && loaded.valid) {
      expect(loaded.plan.phases.length).toBe(2);
    } else {
      throw new Error('plan invalid');
    }
  });
});

describe('next --peek', () => {
  it('does not mutate the plan', async () => {
    await runInit({ codex: true, cwd: tmpDir });
    await writePlan(tmpDir, onePending());
    await runNext({ cwd: tmpDir, peek: true });
    const loaded = await loadPlan(tmpDir);
    if (loaded.exists && loaded.valid) {
      expect(loaded.plan.phases[0].tasks[0].status).toBe('pending');
    }
  });
});

describe('gate --strict', () => {
  it('fails an unresolved gate under --strict but skips it otherwise', async () => {
    await runInit({ codex: true, cwd: tmpDir });
    await setOrchestration(tmpDir, { gates: {}, defaultGates: ['ghost'] });
    await writePlan(tmpDir, onePending()); // task 1.1 gate is 'ghost' (no command)

    await runGateCommand({ cwd: tmpDir, task: '1.1' }); // non-strict: skipped → ok
    expect(process.exitCode).toBe(0);

    process.exitCode = 0;
    await runGateCommand({ cwd: tmpDir, task: '1.1', strict: true }); // strict: fail
    expect(process.exitCode).toBe(1);
  });
});

describe('doctor plan health', () => {
  it('fails when plan.json is structurally invalid', async () => {
    await runInit({ codex: true, cwd: tmpDir });
    // dangling phase dependency → structural error
    await writePlan(tmpDir, {
      ...emptyPlan(new Date('2026-01-01T00:00:00.000Z')),
      phases: [{ id: '1', title: 'P1', goal: '', requirements: [], dependsOn: ['9'], status: 'pending', tasks: [] }],
    });
    await runDoctor({ cwd: tmpDir });
    expect(process.exitCode).toBe(1);
  });
});

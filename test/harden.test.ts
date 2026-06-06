import { describe, expect, it } from 'vitest';
import {
  applyHardenAdditions,
  buildHardenEnvelope,
  buildHardenerPrompt,
  parseHardenAdditions,
} from '../src/core/harden.js';
import { hardeningGaps, matchPacks } from '../src/core/packs.js';
import { validatePlanStructure } from '../src/core/plan.js';
import { parsePlan, type Plan, type Task } from '../src/core/plan-schema.js';

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: '1.1',
    title: 'a task',
    scope: [],
    wave: 1,
    dependsOn: [],
    status: 'pending',
    gates: [],
    acceptance: [],
    waives: [],
    ...overrides,
  };
}

function makePlan(tasks: Task[]): Plan {
  return {
    schemaVersion: 1,
    milestone: 'v1',
    createdAt: '2026-01-01T00:00:00.000Z',
    cursor: { phase: '1', task: tasks[0]?.id ?? null },
    phases: [
      {
        id: '1',
        title: 'Phase one',
        goal: 'do the thing',
        requirements: [],
        dependsOn: [],
        status: 'pending',
        tasks,
      },
    ],
  };
}

describe('pitfall packs', () => {
  it('matches the http-api pack via scope, gates, or keywords', () => {
    expect(matchPacks(makeTask({ scope: ['src/server.js'] })).map((p) => p.id)).toContain('http-api');
    expect(matchPacks(makeTask({ gates: ['smoke'] })).map((p) => p.id)).toContain('http-api');
    expect(matchPacks(makeTask({ title: 'HTTP endpoint for uploads' })).map((p) => p.id)).toContain('http-api');
    expect(matchPacks(makeTask({ title: 'refactor docs' })).map((p) => p.id)).not.toContain('http-api');
  });

  it('reports gaps for applicable criteria with no covering acceptance', () => {
    const task = makeTask({
      title: 'HTTP server: POST /shorten + GET /:slug redirect',
      scope: ['src/server.js'],
      gates: ['smoke'],
      acceptance: [
        { id: 'A1', text: 'POST /shorten with an invalid url returns 400', proof: 'test' },
      ],
    });
    const keys = hardeningGaps(task).map((g) => g.key);
    // input-validation is satisfied (the 400 criterion); these are not:
    expect(keys).toContain('http-api/body-cap');
    expect(keys).toContain('http-api/redirect-cache');
    expect(keys).toContain('http-api/url-scheme-allowlist');
    expect(keys).not.toContain('http-api/input-validation');
  });

  it('skips inapplicable criteria (appliesWhen) and satisfied ones', () => {
    const task = makeTask({
      title: 'HTTP healthcheck endpoint',
      scope: ['src/server.js'],
      acceptance: [
        { id: 'A1', text: 'malformed JSON gets 400; bodies are size-capped with 413', proof: 'test' },
      ],
    });
    const keys = hardeningGaps(task).map((g) => g.key);
    expect(keys).not.toContain('http-api/redirect-cache'); // no redirect wording → inapplicable
    expect(keys).not.toContain('http-api/body-cap'); // satisfied by "413"
    expect(keys).not.toContain('http-api/input-validation'); // satisfied by "400"/"malformed"
  });

  it('honors waivers for a criterion and for a whole pack', () => {
    const base = {
      title: 'file-backed store persistence',
      scope: ['src/store.js'],
    };
    const partial = makeTask({ ...base, waives: ['persistence/atomic-write'] });
    const partialKeys = hardeningGaps(partial).map((g) => g.key);
    expect(partialKeys).not.toContain('persistence/atomic-write');
    expect(partialKeys).toContain('persistence/concurrent-writes');

    const full = makeTask({ ...base, waives: ['persistence'] });
    expect(hardeningGaps(full).filter((g) => g.packId === 'persistence')).toHaveLength(0);
  });

  it('surfaces gaps as plan validate warnings', () => {
    const plan = makePlan([
      makeTask({ title: 'HTTP API server', scope: ['src/server.js'] }),
    ]);
    const validation = validatePlanStructure(plan, []);
    expect(validation.ok).toBe(true); // warnings, not errors
    expect(validation.hardening).toHaveLength(1);
    expect(validation.warnings.some((w) => w.includes('matches pack "http-api"'))).toBe(true);
  });

  it('parses plans without a waives field (backward compatible)', () => {
    const parsed = parsePlan({
      schemaVersion: 1,
      milestone: 'v1',
      createdAt: '2026-01-01T00:00:00.000Z',
      phases: [
        {
          id: '1',
          title: 'p',
          tasks: [{ id: '1.1', title: 't' }],
        },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.plan.phases[0].tasks[0].waives).toEqual([]);
  });
});

describe('plan harden', () => {
  const plan = makePlan([
    makeTask({
      id: '1.1',
      title: 'HTTP server with redirects for short urls',
      scope: ['src/server.js'],
      gates: ['smoke'],
    }),
  ]);

  it('builds an envelope with detected packs and outstanding gaps', () => {
    const envelope = buildHardenEnvelope(plan);
    expect(envelope.detectedPacks).toContain('http-api');
    expect(envelope.outstandingGaps.some((g) => g.key === 'http-api/redirect-cache')).toBe(true);
  });

  it('emits a spawn-ready prompt that demands strict JSON output', () => {
    const prompt = buildHardenerPrompt(buildHardenEnvelope(plan));
    expect(prompt).toContain('domain-hardening reviewer');
    expect(prompt).toContain('Task 1.1');
    expect(prompt).toContain('"additions"');
    expect(prompt).toContain('Return ONLY a JSON object');
  });

  it('parses and validates hardener additions', () => {
    const good = parseHardenAdditions({
      additions: [{ task: '1.1', text: 'Redirects set Cache-Control: no-store', proof: 'test' }],
      notes: 'one gap',
    });
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.additions[0].proof).toBe('test');

    expect(parseHardenAdditions({}).ok).toBe(false);
    expect(parseHardenAdditions({ additions: [{ task: '', text: 'x' }] }).ok).toBe(false);
    expect(parseHardenAdditions({ additions: [{ task: '1.1', text: '' }] }).ok).toBe(false);
  });

  it('applies additions with fresh H<n> ids, skipping unknown tasks and duplicates', () => {
    const target = makePlan([
      makeTask({
        id: '1.1',
        title: 'server',
        acceptance: [{ id: 'H1', text: 'existing hardening criterion', proof: 'test' }],
      }),
    ]);
    const result = applyHardenAdditions(target, [
      { task: '1.1', text: 'Redirects set Cache-Control: no-store', proof: 'test' },
      { task: '1.1', text: 'existing hardening criterion' }, // duplicate text
      { task: '9.9', text: 'nope' }, // unknown task
    ]);

    expect(result.applied).toHaveLength(1);
    expect(result.applied[0].id).toBe('H2'); // H1 taken
    expect(result.skipped.map((s) => s.reason).sort()).toEqual([
      'duplicate of existing criterion',
      'unknown task id',
    ]);
    expect(target.phases[0].tasks[0].acceptance).toHaveLength(2);
  });
});

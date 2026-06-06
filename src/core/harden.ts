import { hardeningGaps, matchPacks } from './packs.js';
import type { Plan, Task } from './plan-schema.js';
import { findTask } from './plan.js';

/**
 * Tier-1 hardening for PLANNING time: one cheap domain-pitfalls agent instead
 * of a research pipeline. agent-flow emits a hardening envelope (the plan +
 * detected domains + outstanding pack gaps); the host spawns ONE reviewer that
 * proposes missing acceptance criteria as JSON; `plan harden --apply` merges
 * them into plan.json — where gates and tier-1 review already enforce them.
 *
 * Same architecture as review emit/record: agent-flow never spawns agents.
 */

export type HardenEnvelope = {
  milestone: string;
  phases: Array<{
    id: string;
    title: string;
    goal: string;
    requirements: string[];
    tasks: Array<{
      id: string;
      title: string;
      scope: string[];
      gates: string[];
      acceptance: Array<{ id: string; text: string; proof?: string }>;
      waives: string[];
    }>;
  }>;
  detectedPacks: string[];
  outstandingGaps: Array<{ task: string; key: string; text: string }>;
};

export function buildHardenEnvelope(plan: Plan): HardenEnvelope {
  const detected = new Set<string>();
  const outstandingGaps: HardenEnvelope['outstandingGaps'] = [];

  for (const phase of plan.phases) {
    for (const task of phase.tasks) {
      for (const pack of matchPacks(task)) detected.add(pack.id);
      for (const gap of hardeningGaps(task)) {
        outstandingGaps.push({ task: task.id, key: gap.key, text: gap.text });
      }
    }
  }

  return {
    milestone: plan.milestone,
    phases: plan.phases.map((phase) => ({
      id: phase.id,
      title: phase.title,
      goal: phase.goal,
      requirements: phase.requirements,
      tasks: phase.tasks.map((task) => ({
        id: task.id,
        title: task.title,
        scope: task.scope,
        gates: task.gates,
        acceptance: task.acceptance.map((a) => ({ id: a.id, text: a.text, proof: a.proof })),
        waives: task.waives,
      })),
    })),
    detectedPacks: [...detected].sort(),
    outstandingGaps,
  };
}

/** A self-contained prompt for a single domain-hardening reviewer agent. */
export function buildHardenerPrompt(envelope: HardenEnvelope): string {
  const lines = [
    'You are a domain-hardening reviewer for a software plan. Your job: find table-stakes',
    'quality/security/correctness criteria the plan is MISSING for its domain — the things a',
    'domain expert would insist on before shipping (atomic writes, input caps, cache headers,',
    'crypto-grade randomness, injection/validation gaps, race conditions, error paths).',
    '',
    `Milestone: ${envelope.milestone}`,
    'Plan:',
  ];

  for (const phase of envelope.phases) {
    lines.push(`  Phase ${phase.id}: ${phase.title} — ${phase.goal || '(no goal stated)'}`);
    if (phase.requirements.length > 0) lines.push(`    Requirements: ${phase.requirements.join(', ')}`);
    for (const task of phase.tasks) {
      lines.push(`    Task ${task.id}: ${task.title}`);
      if (task.scope.length > 0) lines.push(`      Scope: ${task.scope.join(', ')}`);
      if (task.gates.length > 0) lines.push(`      Gates: ${task.gates.join(', ')}`);
      for (const a of task.acceptance) lines.push(`      - ${a.id} [${a.proof ?? 'manual'}]: ${a.text}`);
      if (task.waives.length > 0) lines.push(`      Waived: ${task.waives.join(', ')} (do not re-propose these)`);
    }
  }

  if (envelope.detectedPacks.length > 0) {
    lines.push('', `Detected domains (built-in packs): ${envelope.detectedPacks.join(', ')}`);
  }
  if (envelope.outstandingGaps.length > 0) {
    lines.push('', 'Known gaps already detected deterministically (cover these, refine wording if useful):');
    for (const gap of envelope.outstandingGaps) lines.push(`  - [task ${gap.task}] ${gap.key}: ${gap.text}`);
  }

  lines.push(
    '',
    'Propose ONLY missing acceptance criteria — specific, testable, one capability each.',
    'Do not restate criteria the plan already has. Do not propose new tasks, scope, or features.',
    'Prefer proof "test" when a test can prove it; use "manual" otherwise.',
    'Return ONLY a JSON object on the last line, no prose around it:',
    '  {"additions":[{"task":"<task id>","text":"<criterion>","proof":"test"|"manual"}, ...],"notes":"<one-line summary>"}',
    'If the plan is already adequately hardened, return {"additions":[],"notes":"..."}.',
  );

  return lines.join('\n');
}

export type HardenAddition = { task: string; text: string; proof?: string };

export function parseHardenAdditions(
  value: unknown,
): { ok: true; additions: HardenAddition[]; notes?: string } | { ok: false; error: string } {
  if (typeof value !== 'object' || value === null) return { ok: false, error: 'result is not an object' };
  const obj = value as { additions?: unknown; notes?: unknown };
  if (!Array.isArray(obj.additions)) return { ok: false, error: 'missing "additions" array' };

  const additions: HardenAddition[] = [];
  for (const [index, raw] of obj.additions.entries()) {
    if (typeof raw !== 'object' || raw === null) return { ok: false, error: `additions[${index}] is not an object` };
    const item = raw as { task?: unknown; text?: unknown; proof?: unknown };
    if (typeof item.task !== 'string' || !item.task.trim()) {
      return { ok: false, error: `additions[${index}].task must be a task id` };
    }
    if (typeof item.text !== 'string' || !item.text.trim()) {
      return { ok: false, error: `additions[${index}].text must be a non-empty string` };
    }
    const proof = typeof item.proof === 'string' && item.proof.trim() ? item.proof.trim() : undefined;
    additions.push({ task: item.task.trim(), text: item.text.trim(), proof });
  }

  const notes = typeof obj.notes === 'string' && obj.notes.trim() ? obj.notes.trim() : undefined;
  return { ok: true, additions, notes };
}

export type HardenApplyResult = {
  applied: Array<{ task: string; id: string; text: string; proof?: string }>;
  skipped: Array<{ task: string; text: string; reason: string }>;
};

function nextHardeningId(task: Task): string {
  let n = 1;
  const ids = new Set(task.acceptance.map((a) => a.id));
  while (ids.has(`H${n}`)) n += 1;
  return `H${n}`;
}

/** Mutates the plan in place: append proposed criteria with fresh H<n> ids. */
export function applyHardenAdditions(plan: Plan, additions: HardenAddition[]): HardenApplyResult {
  const applied: HardenApplyResult['applied'] = [];
  const skipped: HardenApplyResult['skipped'] = [];

  for (const addition of additions) {
    const found = findTask(plan, addition.task);
    if (!found) {
      skipped.push({ task: addition.task, text: addition.text, reason: 'unknown task id' });
      continue;
    }
    const duplicate = found.task.acceptance.some(
      (a) => a.text.trim().toLowerCase() === addition.text.trim().toLowerCase(),
    );
    if (duplicate) {
      skipped.push({ task: addition.task, text: addition.text, reason: 'duplicate of existing criterion' });
      continue;
    }
    const id = nextHardeningId(found.task);
    found.task.acceptance.push({ id, text: addition.text, proof: addition.proof });
    applied.push({ task: addition.task, id, text: addition.text, proof: addition.proof });
  }

  return { applied, skipped };
}

import { matchPacks } from './packs.js';
import type { Task } from './plan-schema.js';

/**
 * Deterministic task router: picks how much model a task needs from signals
 * the plan already carries (scope size, acceptance criteria, domain packs,
 * risky wording, dependencies) — zero tokens, no service, reproducible.
 *
 * Inspired by effort routers like Jev, but decided per task (not per request)
 * and from the plan, so it never touches the prompt cache.
 */

export const TIERS = ['light', 'standard', 'deep'] as const;
export type Tier = (typeof TIERS)[number];

export type TierThresholds = { standard: number; deep: number };
export const DEFAULT_TIER_THRESHOLDS: TierThresholds = { standard: 2, deep: 5 };

export type TaskScore = { score: number; tier: Tier; reasons: string[] };

const RISKY_WORDING = /migrat|schema|concurren|race\b|deadlock|transaction|security|auth|password|token|payment|billing|stripe|crypto|encrypt|refactor|breaking/i;

const PACK_WEIGHT: Record<string, number> = {
  'auth-secrets': 2,
  persistence: 2,
  'http-api': 1,
  randomness: 1,
};

export function scoreTask(task: Task, thresholds: TierThresholds = DEFAULT_TIER_THRESHOLDS): TaskScore {
  const reasons: string[] = [];
  let score = 0;
  const add = (points: number, reason: string): void => {
    if (points <= 0) return;
    score += points;
    reasons.push(`+${points} ${reason}`);
  };

  const files = task.scope.length;
  if (files === 0) add(1, 'no scope declared (uncertain footprint)');
  else if (files >= 7) add(3, `${files} scope files`);
  else if (files >= 4) add(2, `${files} scope files`);
  else if (files >= 2) add(1, `${files} scope files`);

  const criteria = task.acceptance.length;
  if (criteria >= 6) add(2, `${criteria} acceptance criteria`);
  else if (criteria >= 3) add(1, `${criteria} acceptance criteria`);

  if (task.acceptance.some((a) => /^H\d+$/.test(a.id))) add(1, 'hardening criteria');

  const waived = new Set(task.waives);
  const packs = matchPacks(task).filter((pack) => !waived.has(pack.id));
  const packPoints = Math.min(3, packs.reduce((sum, pack) => sum + (PACK_WEIGHT[pack.id] ?? 1), 0));
  add(packPoints, `domain packs: ${packs.map((p) => p.id).join(', ')}`);

  if (task.gates.includes('smoke')) add(1, 'smoke gate');
  if (task.dependsOn.length >= 2) add(1, `${task.dependsOn.length} dependencies`);

  const text = [task.title, ...task.acceptance.map((a) => a.text)].join(' ');
  const risky = RISKY_WORDING.exec(text);
  if (risky) add(2, `risky wording ("${risky[0]}")`);

  const tier: Tier = score >= thresholds.deep ? 'deep' : score >= thresholds.standard ? 'standard' : 'light';
  return { score, tier, reasons };
}

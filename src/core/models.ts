import path from 'node:path';
import fs from 'fs-extra';
import { readConfig } from './config.js';
import type { Task } from './plan-schema.js';
import { DEFAULT_TIER_THRESHOLDS, scoreTask, TIERS, type Tier, type TierThresholds } from './router.js';

/**
 * Token-aware model routing for orchestration roles.
 *
 * Default: every role runs on a mid-tier model; a task escalates to the
 * stronger model only after its gates keep failing. Quality is still decided
 * by gates and independent review — routing only decides what it costs.
 */

export type ModelRole = 'executor' | 'reviewer' | 'hardener';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type TierSpec = { model: string; effort: Effort };

/** Executor subagent installed for each tier (effort is fixed per agent definition). */
export const TIER_AGENTS: Record<Tier, string> = {
  light: 'flow-executor-light',
  standard: 'flow-executor',
  deep: 'flow-executor-deep',
};

export type ModelRouting = {
  /** Executor model and effort per routed tier. */
  tiers: Record<Tier, TierSpec>;
  /** Deterministic routing by task signals; when disabled every task uses the standard tier. */
  router: { enabled: boolean; thresholds: TierThresholds };
  executor: string;
  reviewer: string;
  hardener: string;
  /** Model a task's executor escalates to after repeated gate failures. */
  escalation: string;
  /** Consecutive red attempts on one task before its executor climbs one rung (light → standard → deep → escalation). 0 disables escalation. */
  escalateAfterFailures: number;
  /** Advisory per-agent context budget; agents hand off instead of growing past it. */
  contextBudgetTokens: number;
};

export const DEFAULT_MODEL_ROUTING: ModelRouting = {
  tiers: {
    light: { model: 'haiku', effort: 'low' },
    standard: { model: 'sonnet', effort: 'medium' },
    deep: { model: 'sonnet', effort: 'high' },
  },
  router: { enabled: true, thresholds: DEFAULT_TIER_THRESHOLDS },
  executor: 'sonnet',
  reviewer: 'sonnet',
  hardener: 'sonnet',
  escalation: 'opus',
  escalateAfterFailures: 2,
  contextBudgetTokens: 150_000,
};

function nonEmptyString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function nonNegativeInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback;
}

const EFFORTS = new Set<Effort>(['low', 'medium', 'high', 'xhigh', 'max']);

function tierSpec(value: unknown, fallback: TierSpec): TierSpec {
  const v = (value ?? {}) as Record<string, unknown>;
  const effort = typeof v.effort === 'string' && EFFORTS.has(v.effort as Effort) ? (v.effort as Effort) : fallback.effort;
  return { model: nonEmptyString(v.model, fallback.model), effort };
}

export async function getModelRouting(root: string): Promise<ModelRouting> {
  const config = await readConfig(root);
  const orchestration = (config?.orchestration ?? {}) as Record<string, unknown>;
  const models = (orchestration.models ?? {}) as Record<string, unknown>;
  const tiers = (orchestration.tiers ?? {}) as Record<string, unknown>;
  const router = (orchestration.router ?? {}) as Record<string, unknown>;
  const thresholds = (router.thresholds ?? {}) as Record<string, unknown>;
  const d = DEFAULT_MODEL_ROUTING;
  // Back-compat: models.executor sets the standard tier when no tiers are configured.
  const standardFallback = { ...d.tiers.standard, model: nonEmptyString(models.executor, d.tiers.standard.model) };
  return {
    tiers: {
      light: tierSpec(tiers.light, d.tiers.light),
      standard: tierSpec(tiers.standard, standardFallback),
      deep: tierSpec(tiers.deep, d.tiers.deep),
    },
    router: {
      enabled: router.enabled !== false,
      thresholds: {
        standard: nonNegativeInt(thresholds.standard, d.router.thresholds.standard),
        deep: nonNegativeInt(thresholds.deep, d.router.thresholds.deep),
      },
    },
    executor: nonEmptyString(models.executor, d.executor),
    reviewer: nonEmptyString(models.reviewer, d.reviewer),
    hardener: nonEmptyString(models.hardener, d.hardener),
    escalation: nonEmptyString(models.escalation, d.escalation),
    escalateAfterFailures: nonNegativeInt(orchestration.escalateAfterFailures, d.escalateAfterFailures),
    contextBudgetTokens: nonNegativeInt(orchestration.contextBudgetTokens, d.contextBudgetTokens) || d.contextBudgetTokens,
  };
}

// ---------------------------------------------------------------------------
// Per-task gate history (drives escalation)
// ---------------------------------------------------------------------------

export type TaskGateStats = {
  runs: number;
  failures: number;
  consecutiveFailures: number;
  lastAt: string;
};

const TASK_STATS_RELATIVE = path.join('.agent-flow', 'task-stats.json');

export function taskStatsPath(root: string): string {
  return path.join(root, TASK_STATS_RELATIVE);
}

export async function readTaskStats(root: string): Promise<Record<string, TaskGateStats>> {
  const file = taskStatsPath(root);
  if (!(await fs.pathExists(file))) return {};
  try {
    const data = await fs.readJson(file);
    return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, TaskGateStats>) : {};
  } catch {
    return {};
  }
}

export async function recordGateOutcome(root: string, taskId: string, ok: boolean, at = new Date()): Promise<TaskGateStats> {
  const stats = await readTaskStats(root);
  const prev = stats[taskId] ?? { runs: 0, failures: 0, consecutiveFailures: 0, lastAt: '' };
  const next: TaskGateStats = {
    runs: prev.runs + 1,
    failures: prev.failures + (ok ? 0 : 1),
    consecutiveFailures: ok ? 0 : prev.consecutiveFailures + 1,
    lastAt: at.toISOString(),
  };
  stats[taskId] = next;
  const file = taskStatsPath(root);
  await fs.ensureDir(path.dirname(file));
  await fs.writeJson(file, stats, { spaces: 2 });
  return next;
}

export type ExecutorAssignment = {
  /** Subagent to spawn (its definition fixes the effort). */
  agent: string;
  /** Model to pass on the Agent call (overrides the definition's model). */
  model: string;
  effort: Effort;
  /** Tier the router chose from the task's signals. */
  tier: Tier;
  /** Rung actually assigned after escalation. */
  rung: Tier | 'escalation';
  escalated: boolean;
  score: number;
  reasons: string[];
  reason: string;
  contextBudgetTokens: number;
};

/**
 * Route a task to an executor: the router picks a starting tier from the task's
 * signals (or the task's explicit `tier`), then every `escalateAfterFailures`
 * consecutive red attempts climb one rung: light → standard → deep → escalation.
 */
export function executorAssignment(routing: ModelRouting, stats: TaskGateStats | undefined, task?: Task): ExecutorAssignment {
  const scored = task ? scoreTask(task, routing.router.thresholds) : { score: 0, tier: 'standard' as Tier, reasons: [] };
  let tier: Tier = 'standard';
  let why = 'router disabled';
  if (task?.tier) {
    tier = task.tier;
    why = `plan sets tier ${task.tier}`;
  } else if (routing.router.enabled && task) {
    tier = scored.tier;
    why = `score ${scored.score}`;
  }

  const failures = stats?.consecutiveFailures ?? 0;
  const climbs = routing.escalateAfterFailures > 0 ? Math.floor(failures / routing.escalateAfterFailures) : 0;
  const ladder: Array<Tier | 'escalation'> = [...TIERS, 'escalation'];
  const rungIndex = Math.min(ladder.length - 1, TIERS.indexOf(tier) + climbs);
  const rung = ladder[rungIndex];

  const spec: TierSpec = rung === 'escalation' ? { model: routing.escalation, effort: routing.tiers.deep.effort } : routing.tiers[rung];
  const agent = TIER_AGENTS[rung === 'escalation' ? 'deep' : rung];
  const escalated = climbs > 0 && rung !== tier;

  return {
    agent,
    model: spec.model,
    effort: spec.effort,
    tier,
    rung,
    escalated,
    score: scored.score,
    reasons: scored.reasons,
    reason: escalated
      ? `${tier} → ${rung} after ${failures} consecutive red attempt(s)`
      : failures > 0
        ? `${tier} (${why}); ${failures} red attempt(s), climbs every ${routing.escalateAfterFailures}`
        : `${tier} (${why})`,
    contextBudgetTokens: routing.contextBudgetTokens,
  };
}

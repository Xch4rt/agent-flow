import path from 'node:path';
import fs from 'fs-extra';
import { readConfig } from './config.js';

/**
 * Token-aware model routing for orchestration roles.
 *
 * Default: every role runs on a mid-tier model; a task escalates to the
 * stronger model only after its gates keep failing. Quality is still decided
 * by gates and independent review — routing only decides what it costs.
 */

export type ModelRole = 'executor' | 'reviewer' | 'hardener';

export type ModelRouting = {
  executor: string;
  reviewer: string;
  hardener: string;
  /** Model a task's executor escalates to after repeated gate failures. */
  escalation: string;
  /** Consecutive red gate runs on one task before its executor escalates. 0 disables escalation. */
  escalateAfterFailures: number;
  /** Advisory per-agent context budget; agents hand off instead of growing past it. */
  contextBudgetTokens: number;
};

export const DEFAULT_MODEL_ROUTING: ModelRouting = {
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

export async function getModelRouting(root: string): Promise<ModelRouting> {
  const config = await readConfig(root);
  const orchestration = (config?.orchestration ?? {}) as Record<string, unknown>;
  const models = (orchestration.models ?? {}) as Record<string, unknown>;
  const d = DEFAULT_MODEL_ROUTING;
  return {
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
  agent: 'flow-executor';
  model: string;
  escalated: boolean;
  reason: string;
  contextBudgetTokens: number;
};

export function executorAssignment(routing: ModelRouting, stats: TaskGateStats | undefined): ExecutorAssignment {
  const failures = stats?.consecutiveFailures ?? 0;
  const escalate = routing.escalateAfterFailures > 0 && failures >= routing.escalateAfterFailures && routing.escalation !== routing.executor;
  return {
    agent: 'flow-executor',
    model: escalate ? routing.escalation : routing.executor,
    escalated: escalate,
    reason: escalate
      ? `${failures} consecutive red gate run(s) ≥ escalateAfterFailures (${routing.escalateAfterFailures})`
      : failures > 0
        ? `${failures} red gate run(s); escalates at ${routing.escalateAfterFailures}`
        : 'default executor model',
    contextBudgetTokens: routing.contextBudgetTokens,
  };
}

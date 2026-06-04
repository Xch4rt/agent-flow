import path from 'node:path';
import fs from 'fs-extra';
import { parsePlan, type Phase, type Plan, type PlanParseError, type Task } from './plan-schema.js';

export const PLAN_RELATIVE_PATH = path.join('.agent-flow', 'plan.json');

export function planPath(root: string): string {
  return path.join(root, PLAN_RELATIVE_PATH);
}

export type LoadPlanResult =
  | { exists: false }
  | { exists: true; valid: false; errors: PlanParseError[] }
  | { exists: true; valid: true; plan: Plan };

export async function loadPlan(root: string): Promise<LoadPlanResult> {
  const file = planPath(root);
  if (!(await fs.pathExists(file))) return { exists: false };

  let raw: unknown;
  try {
    raw = await fs.readJson(file);
  } catch (err) {
    return {
      exists: true,
      valid: false,
      errors: [{ path: 'plan', message: `invalid JSON: ${(err as Error).message}` }],
    };
  }

  const parsed = parsePlan(raw);
  if (!parsed.ok) return { exists: true, valid: false, errors: parsed.errors };
  return { exists: true, valid: true, plan: parsed.plan };
}

export async function writePlan(root: string, plan: Plan, now = new Date()): Promise<void> {
  const file = planPath(root);
  await fs.ensureDir(path.dirname(file));
  await fs.writeJson(file, { ...plan, updatedAt: now.toISOString() }, { spaces: 2 });
}

export function emptyPlan(now = new Date(), milestone = 'v1'): Plan {
  return {
    schemaVersion: 1,
    milestone,
    createdAt: now.toISOString(),
    cursor: { phase: null, task: null },
    phases: [],
  };
}

/** Extract the requirement-id universe from REQUIREMENTS.md (deterministic, no LLM). */
export async function parseRequirementUniverse(root: string): Promise<string[]> {
  const file = path.join(root, '.planning', 'REQUIREMENTS.md');
  if (!(await fs.pathExists(file))) return [];
  const text = await fs.readFile(file, 'utf8');
  const ids = new Set<string>();
  const re = /\b[A-Z][A-Z0-9]*-\d+\b/g;
  for (const match of text.matchAll(re)) ids.add(match[0]);
  return [...ids].sort();
}

// ---------------------------------------------------------------------------
// Structural validation (errors block; warnings inform)
// ---------------------------------------------------------------------------

export type PlanValidation = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  coverage: { unmapped: string[]; unknown: string[]; duplicated: string[] };
};

/** Kahn's algorithm: returns node ids that remain in a cycle (best-effort). */
function nodesInCycle(nodes: string[], edges: Map<string, string[]>): string[] {
  const indeg = new Map<string, number>();
  for (const n of nodes) indeg.set(n, 0);
  for (const n of nodes) {
    for (const dep of edges.get(n) ?? []) {
      // edge dep -> n (dep must come first); n depends on dep
      if (indeg.has(dep)) indeg.set(n, (indeg.get(n) ?? 0) + 1);
    }
  }
  const queue = nodes.filter((n) => (indeg.get(n) ?? 0) === 0);
  const removed = new Set<string>();
  while (queue.length > 0) {
    const n = queue.shift() as string;
    removed.add(n);
    for (const m of nodes) {
      if (removed.has(m)) continue;
      if ((edges.get(m) ?? []).includes(n)) {
        indeg.set(m, (indeg.get(m) ?? 0) - 1);
        if ((indeg.get(m) ?? 0) === 0) queue.push(m);
      }
    }
  }
  return nodes.filter((n) => !removed.has(n));
}

function findDuplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dups.add(id);
    seen.add(id);
  }
  return [...dups];
}

export function validatePlanStructure(plan: Plan, universe: string[]): PlanValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  // --- id uniqueness ---
  const phaseIds = plan.phases.map((p) => p.id);
  for (const dup of findDuplicates(phaseIds)) errors.push(`duplicate phase id: ${dup}`);

  for (const phase of plan.phases) {
    const taskIds = phase.tasks.map((t) => t.id);
    for (const dup of findDuplicates(taskIds)) {
      errors.push(`duplicate task id in phase ${phase.id}: ${dup}`);
    }
  }

  // --- dangling phase dependsOn ---
  const phaseIdSet = new Set(phaseIds);
  for (const phase of plan.phases) {
    for (const dep of phase.dependsOn) {
      if (!phaseIdSet.has(dep)) errors.push(`phase ${phase.id} depends on unknown phase ${dep}`);
      if (dep === phase.id) errors.push(`phase ${phase.id} depends on itself`);
    }
  }

  // --- phase DAG cycles ---
  const phaseEdges = new Map<string, string[]>(plan.phases.map((p) => [p.id, p.dependsOn]));
  const phaseCycle = nodesInCycle(phaseIds, phaseEdges);
  if (phaseCycle.length > 0) errors.push(`phase dependency cycle: ${phaseCycle.join(' -> ')}`);

  // --- per-phase task validation ---
  for (const phase of plan.phases) {
    const taskIdSet = new Set(phase.tasks.map((t) => t.id));
    const taskWave = new Map(phase.tasks.map((t) => [t.id, t.wave]));

    for (const task of phase.tasks) {
      for (const dep of task.dependsOn) {
        if (!taskIdSet.has(dep)) {
          errors.push(`task ${phase.id}/${task.id} depends on unknown task ${dep}`);
          continue;
        }
        if (dep === task.id) errors.push(`task ${phase.id}/${task.id} depends on itself`);
        // wave-order: a dependency should run in an earlier wave
        const depWave = taskWave.get(dep);
        if (depWave !== undefined && depWave >= task.wave) {
          warnings.push(
            `task ${phase.id}/${task.id} (wave ${task.wave}) depends on ${dep} (wave ${depWave}); dependency is not in an earlier wave`,
          );
        }
      }
    }

    const taskCycle = nodesInCycle(
      phase.tasks.map((t) => t.id),
      new Map(phase.tasks.map((t) => [t.id, t.dependsOn])),
    );
    if (taskCycle.length > 0) {
      errors.push(`task dependency cycle in phase ${phase.id}: ${taskCycle.join(' -> ')}`);
    }
  }

  // --- requirement coverage ---
  const mapped = new Map<string, number>();
  for (const phase of plan.phases) {
    for (const req of phase.requirements) mapped.set(req, (mapped.get(req) ?? 0) + 1);
  }
  const universeSet = new Set(universe);
  const unmapped = universe.filter((req) => !mapped.has(req));
  const unknown = [...mapped.keys()].filter((req) => !universeSet.has(req)).sort();
  const duplicated = [...mapped.entries()].filter(([, count]) => count > 1).map(([req]) => req).sort();

  if (universe.length > 0 && unmapped.length > 0) {
    warnings.push(`unmapped requirements (${unmapped.length}): ${unmapped.join(', ')}`);
  }
  if (unknown.length > 0) {
    warnings.push(`requirements not found in REQUIREMENTS.md (${unknown.length}): ${unknown.join(', ')}`);
  }
  for (const req of duplicated) warnings.push(`requirement ${req} mapped to more than one phase`);

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    coverage: { unmapped, unknown, duplicated },
  };
}

// ---------------------------------------------------------------------------
// Query helpers (used by status now; by `next`/`advance` in Phase B)
// ---------------------------------------------------------------------------

export type Progress = {
  phasesTotal: number;
  phasesDone: number;
  tasksTotal: number;
  tasksDone: number;
  percent: number;
};

export function computeProgress(plan: Plan): Progress {
  const phasesTotal = plan.phases.length;
  const phasesDone = plan.phases.filter((p) => p.status === 'done').length;
  let tasksTotal = 0;
  let tasksDone = 0;
  for (const phase of plan.phases) {
    for (const task of phase.tasks) {
      tasksTotal += 1;
      if (task.status === 'done') tasksDone += 1;
    }
  }
  const percent = tasksTotal === 0 ? 0 : Math.round((tasksDone / tasksTotal) * 100);
  return { phasesTotal, phasesDone, tasksTotal, tasksDone, percent };
}

export function phaseProgress(phase: Phase): { done: number; total: number } {
  return {
    done: phase.tasks.filter((t) => t.status === 'done').length,
    total: phase.tasks.length,
  };
}

function depsSatisfied(deps: string[], doneIds: Set<string>): boolean {
  return deps.every((d) => doneIds.has(d));
}

/**
 * The next actionable task: earliest phase whose phase-deps are done, then the
 * lowest-wave pending task whose task-deps are done. Deterministic, no LLM.
 */
export function nextTask(plan: Plan): { phase: Phase; task: Task } | null {
  const donePhaseIds = new Set(plan.phases.filter((p) => p.status === 'done').map((p) => p.id));

  for (const phase of plan.phases) {
    if (phase.status === 'done') continue;
    if (!depsSatisfied(phase.dependsOn, donePhaseIds)) continue;

    const doneTaskIds = new Set(phase.tasks.filter((t) => t.status === 'done').map((t) => t.id));
    const candidates = phase.tasks
      .filter((t) => t.status !== 'done' && t.status !== 'blocked')
      .filter((t) => depsSatisfied(t.dependsOn, doneTaskIds))
      .sort((a, b) => a.wave - b.wave);

    if (candidates.length > 0) return { phase, task: candidates[0] };
  }

  return null;
}

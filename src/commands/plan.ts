import fs from 'fs-extra';
import pc from 'picocolors';
import { brandTitle, keyValue, section, statusLabel } from '../core/terminal-ui.js';
import {
  computeProgress,
  emptyPlan,
  loadPlan,
  nextTask,
  parseRequirementUniverse,
  phaseProgress,
  planPath,
  validatePlanStructure,
  writePlan,
} from '../core/plan.js';

export type PlanInitOptions = { cwd?: string; force?: boolean; json?: boolean };
export type PlanValidateOptions = { cwd?: string; json?: boolean };
export type PlanShowOptions = { cwd?: string; json?: boolean };

export async function runPlanInit(options: PlanInitOptions = {}): Promise<void> {
  const root = options.cwd ?? process.cwd();
  const existing = await loadPlan(root);

  if (existing.exists && !options.force) {
    console.log(`${statusLabel('skipped')} ${planPath(root)} already exists (use --force to recreate)`);
    return;
  }

  const universe = await parseRequirementUniverse(root);
  const plan = emptyPlan();
  await writePlan(root, plan);

  if (options.json) {
    console.log(JSON.stringify({ created: true, path: planPath(root), requirements: universe }, null, 2));
    return;
  }

  console.log(brandTitle('agent-flow plan init'));
  console.log(`${statusLabel('ok')} created ${planPath(root)}`);
  console.log('');
  if (universe.length > 0) {
    console.log(section(`Requirements found in REQUIREMENTS.md (${universe.length}):`));
    console.log(`  ${universe.join(', ')}`);
    console.log('');
    console.log('Author phases/tasks in the plan (directly or via /flow-plan), then:');
  } else {
    console.log('No requirement ids found in .planning/REQUIREMENTS.md.');
    console.log('Add requirements (e.g. AUTH-01), author phases, then:');
  }
  console.log(`  ${pc.cyan('agent-flow plan validate')}`);
}

function printValidation(root: string, label: string, validation: ReturnType<typeof validatePlanStructure>): void {
  console.log(brandTitle(label));
  for (const error of validation.errors) console.log(`${statusLabel('fail')} ${error}`);
  for (const warning of validation.warnings) console.log(`${statusLabel('warning')} ${warning}`);
  if (validation.errors.length === 0 && validation.warnings.length === 0) {
    console.log(`${statusLabel('ok')} plan is structurally valid; no warnings`);
  } else if (validation.errors.length === 0) {
    console.log(`${statusLabel('ok')} no blocking errors`);
  }
  void root;
}

export async function runPlanValidate(options: PlanValidateOptions = {}): Promise<void> {
  const root = options.cwd ?? process.cwd();
  const loaded = await loadPlan(root);

  if (!loaded.exists) {
    console.log(`${statusLabel('fail')} no plan found. Run: agent-flow plan init`);
    process.exitCode = 1;
    return;
  }
  if (!loaded.valid) {
    if (options.json) {
      console.log(JSON.stringify({ ok: false, errors: loaded.errors }, null, 2));
    } else {
      console.log(brandTitle('agent-flow plan validate'));
      for (const error of loaded.errors) console.log(`${statusLabel('fail')} ${error.path}: ${error.message}`);
    }
    process.exitCode = 1;
    return;
  }

  const universe = await parseRequirementUniverse(root);
  const validation = validatePlanStructure(loaded.plan, universe);

  if (options.json) {
    console.log(JSON.stringify({ ...validation, progress: computeProgress(loaded.plan) }, null, 2));
  } else {
    printValidation(root, 'agent-flow plan validate', validation);
  }

  if (!validation.ok) process.exitCode = 1;
}

export async function runPlanShow(options: PlanShowOptions = {}): Promise<void> {
  const root = options.cwd ?? process.cwd();
  const loaded = await loadPlan(root);

  if (!loaded.exists) {
    console.log(`${statusLabel('fail')} no plan found. Run: agent-flow plan init`);
    process.exitCode = 1;
    return;
  }
  if (!loaded.valid) {
    console.log(`${statusLabel('fail')} plan is invalid. Run: agent-flow plan validate`);
    process.exitCode = 1;
    return;
  }

  const plan = loaded.plan;
  const progress = computeProgress(plan);
  const upNext = nextTask(plan);

  if (options.json) {
    console.log(JSON.stringify({ plan, progress, next: upNext ? { phase: upNext.phase.id, task: upNext.task.id } : null }, null, 2));
    return;
  }

  console.log(brandTitle('agent-flow plan'));
  console.log(keyValue('Milestone:', plan.milestone));
  console.log(
    keyValue('Progress:', `${progress.tasksDone}/${progress.tasksTotal} tasks (${progress.percent}%), ${progress.phasesDone}/${progress.phasesTotal} phases`),
  );
  console.log(section('Phases:'));
  for (const phase of plan.phases) {
    const pp = phaseProgress(phase);
    console.log(`  [${phase.status}] ${phase.id} ${phase.title} — ${pp.done}/${pp.total} tasks`);
    for (const task of phase.tasks) {
      console.log(`     - [${task.status}] ${task.id} (wave ${task.wave}) ${task.title}`);
    }
  }
  console.log(section('Up next:'));
  console.log(upNext ? `  ${upNext.phase.id}/${upNext.task.id} — ${upNext.task.title}` : '  nothing actionable (all done or blocked)');
}

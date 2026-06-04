import pc from 'picocolors';
import { buildContextPack, formatContextPack } from '../core/context-pack.js';
import { appendMemoryEntry } from '../core/jsonl-memory.js';
import {
  loadPlan,
  resolveTargetTask,
  setTaskStatus,
  writePlan,
} from '../core/plan.js';
import {
  getDefaultGates,
  readGateCache,
  resolveGateCommands,
  runGates,
  worktreeSignature,
  writeGateCache,
  type GateResult,
} from '../core/gates.js';
import type { Plan, Task } from '../core/plan-schema.js';
import { brandTitle, keyValue, section, statusLabel } from '../core/terminal-ui.js';

export type NextOptions = { cwd?: string; json?: boolean; budgetLines?: string | number };
export type GateCmdOptions = { cwd?: string; task?: string; json?: boolean };
export type AdvanceOptions = { cwd?: string; task?: string; gate?: boolean; json?: boolean };

function parseBudgetLines(value: string | number | undefined): number {
  if (value === undefined) return 100;
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 100;
}

async function loadValidPlan(root: string): Promise<Plan | null> {
  const loaded = await loadPlan(root);
  if (!loaded.exists) {
    console.log(`${statusLabel('fail')} no plan found. Run: agent-flow plan init`);
    process.exitCode = 1;
    return null;
  }
  if (!loaded.valid) {
    console.log(`${statusLabel('fail')} plan is invalid. Run: agent-flow plan validate`);
    process.exitCode = 1;
    return null;
  }
  return loaded.plan;
}

function gateNamesFor(task: Task, fallback: string[]): string[] {
  return task.gates.length > 0 ? task.gates : fallback;
}

// ---------------------------------------------------------------------------
// agent-flow next
// ---------------------------------------------------------------------------

export async function runNext(options: NextOptions = {}): Promise<void> {
  const root = options.cwd ?? process.cwd();
  const plan = await loadValidPlan(root);
  if (!plan) return;

  const target = resolveTargetTask(plan);
  if (!target) {
    console.log(brandTitle('agent-flow next'));
    console.log(`${statusLabel('ok')} nothing actionable — all tasks are done or blocked`);
    return;
  }

  const { phase, task } = target;

  // Mark in-flight (idempotent) so status reflects the active task.
  if (task.status === 'pending') {
    setTaskStatus(plan, task.id, 'active');
    await writePlan(root, plan);
  }

  const commands = await resolveGateCommands(root);
  const gateNames = gateNamesFor(task, await getDefaultGates(root));
  const gateLines = gateNames.map((name) => `  ${name}: ${commands[name] ?? '(no command — will be skipped)'}`);

  const pack = await buildContextPack(`${phase.title}: ${task.title}`, { cwd: root, limit: 5, budgetLines: parseBudgetLines(options.budgetLines) });
  const formattedPack = formatContextPack(pack, { budgetLines: parseBudgetLines(options.budgetLines) });

  if (options.json) {
    console.log(JSON.stringify({
      phase: { id: phase.id, title: phase.title },
      task: { id: task.id, title: task.title, scope: task.scope, wave: task.wave },
      acceptance: task.acceptance,
      gates: gateNames.map((name) => ({ name, command: commands[name] ?? null })),
      contextPack: pack,
    }, null, 2));
    return;
  }

  console.log(brandTitle('agent-flow next'));
  console.log(keyValue('Task:', `${task.id} — ${task.title}`));
  console.log(keyValue('Phase:', `${phase.id} ${phase.title}`));
  if (task.scope.length > 0) console.log(keyValue('Scope:', task.scope.join(', ')));
  if (task.acceptance.length > 0) {
    console.log(section('Acceptance:'));
    for (const a of task.acceptance) console.log(`  - ${a.id} [${a.proof ?? 'manual'}] ${a.text}`);
  }
  console.log(section('Gates:'));
  for (const line of gateLines) console.log(line);
  console.log(section('Scoped context:'));
  console.log(formattedPack.trimEnd());
  console.log('');
  console.log(pc.bold('Recommended next:'));
  console.log(`  1) implement, then:  ${pc.cyan(`agent-flow gate --task ${task.id}`)}`);
  console.log(`  2) on green:         ${pc.cyan(`agent-flow advance --task ${task.id}`)}`);
}

// ---------------------------------------------------------------------------
// agent-flow gate
// ---------------------------------------------------------------------------

function printGateResults(results: GateResult[]): void {
  for (const r of results) {
    if (r.skipped) {
      console.log(`${statusLabel('warning')} ${r.name}: skipped (${r.outputTail})`);
    } else if (r.ok) {
      console.log(`${statusLabel('ok')} ${r.name}: passed (${r.command})`);
    } else {
      console.log(`${statusLabel('fail')} ${r.name}: failed exit ${r.exitCode} (${r.command})`);
      if (r.outputTail) console.log(r.outputTail.split('\n').map((l) => `    ${l}`).join('\n'));
    }
  }
}

export async function runGateCommand(options: GateCmdOptions = {}): Promise<void> {
  const root = options.cwd ?? process.cwd();
  const plan = await loadValidPlan(root);
  if (!plan) return;

  const target = resolveTargetTask(plan, options.task);
  if (!target) {
    console.log(`${statusLabel('fail')} no task to gate (id not found, or nothing actionable)`);
    process.exitCode = 1;
    return;
  }

  const { task } = target;
  const gateNames = gateNamesFor(task, await getDefaultGates(root));
  const run = await runGates(root, gateNames);

  await writeGateCache(root, {
    task: task.id,
    signature: await worktreeSignature(root),
    ok: run.ok,
    gates: gateNames,
    at: new Date().toISOString(),
  });

  if (options.json) {
    console.log(JSON.stringify({ task: task.id, ok: run.ok, results: run.results }, null, 2));
  } else {
    console.log(brandTitle('agent-flow gate'));
    console.log(keyValue('Task:', `${task.id} — ${task.title}`));
    printGateResults(run.results);
    console.log(run.ok ? `${statusLabel('ok')} all gates green` : `${statusLabel('fail')} gate failed — fix and re-run`);
    if (run.ok) console.log(`Next: ${pc.cyan(`agent-flow advance --task ${task.id}`)}`);
  }

  if (!run.ok) process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// agent-flow advance
// ---------------------------------------------------------------------------

export async function runAdvance(options: AdvanceOptions = {}): Promise<void> {
  const root = options.cwd ?? process.cwd();
  const plan = await loadValidPlan(root);
  if (!plan) return;

  const target = resolveTargetTask(plan, options.task);
  if (!target) {
    console.log(`${statusLabel('fail')} no task to advance (id not found, or nothing actionable)`);
    process.exitCode = 1;
    return;
  }

  const { phase, task } = target;
  const gateNames = gateNamesFor(task, await getDefaultGates(root));

  // Determine whether gates are green for THIS code.
  let gateOk: boolean;
  let gateDetail: string;
  if (options.gate) {
    const run = await runGates(root, gateNames);
    await writeGateCache(root, {
      task: task.id,
      signature: await worktreeSignature(root),
      ok: run.ok,
      gates: gateNames,
      at: new Date().toISOString(),
    });
    gateOk = run.ok;
    gateDetail = run.ok ? 'gates re-run and green' : 'gates re-run and FAILED';
    if (!run.ok) printGateResults(run.results);
  } else {
    const cache = await readGateCache(root);
    const signature = await worktreeSignature(root);
    if (!cache || cache.task !== task.id) {
      gateOk = false;
      gateDetail = `no gate result for task ${task.id}`;
    } else if (cache.signature !== signature) {
      gateOk = false;
      gateDetail = 'code changed since the gate ran (stale)';
    } else if (!cache.ok) {
      gateOk = false;
      gateDetail = 'last gate failed';
    } else {
      gateOk = true;
      gateDetail = 'cached gate green for current code';
    }
  }

  if (!gateOk) {
    console.log(brandTitle('agent-flow advance'));
    console.log(`${statusLabel('fail')} cannot advance ${task.id}: ${gateDetail}`);
    console.log(`Run: ${pc.cyan(`agent-flow gate --task ${task.id}`)} (or ${pc.cyan(`agent-flow advance --task ${task.id} --gate`)})`);
    process.exitCode = 1;
    return;
  }

  // Advance state.
  setTaskStatus(plan, task.id, 'done');
  await writePlan(root, plan);

  // Auto-capture durable memory (continuity without manual close).
  try {
    await appendMemoryEntry(root, 'events', {
      type: 'change',
      summary: `Completed ${task.id} — ${task.title} (phase ${phase.id}: ${phase.title}); gates green`,
      module: phase.title,
      files: task.scope.length > 0 ? task.scope : undefined,
      tags: ['orchestration'],
    });
  } catch {
    // duplicate or memory unavailable — non-fatal
  }

  const phaseClosed = phase.tasks.every((t) => t.status === 'done');

  if (options.json) {
    console.log(JSON.stringify({ advanced: task.id, phaseClosed, cursor: plan.cursor }, null, 2));
    return;
  }

  console.log(brandTitle('agent-flow advance'));
  console.log(`${statusLabel('ok')} ${task.id} done (${gateDetail})`);
  if (phaseClosed) console.log(`${statusLabel('ok')} phase ${phase.id} (${phase.title}) complete`);
  console.log(keyValue('Memory:', 'appended completion event'));
  if (plan.cursor.task) {
    console.log(`Next: ${pc.cyan('agent-flow next')} → ${plan.cursor.phase}/${plan.cursor.task}`);
  } else {
    console.log(`${statusLabel('ok')} plan complete — nothing left actionable`);
  }
}

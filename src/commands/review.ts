import pc from 'picocolors';
import { buildContextPack, formatContextPack } from '../core/context-pack.js';
import { worktreeSignature } from '../core/gates.js';
import { loadPlan } from '../core/plan.js';
import {
  buildReviewEnvelope,
  readReviewRecord,
  reviewStatus,
  writeReviewRecord,
  type ReviewVerdict,
} from '../core/review.js';
import type { Phase, Plan } from '../core/plan-schema.js';
import { brandTitle, keyValue, section, statusLabel } from '../core/terminal-ui.js';

export type ReviewEmitOptions = { cwd?: string; phase?: string; json?: boolean };
export type ReviewRecordOptions = { cwd?: string; phase?: string; verdict?: string; notes?: string; json?: boolean };

async function loadPhase(root: string, phaseId: string | undefined): Promise<{ plan: Plan; phase: Phase } | null> {
  if (!phaseId) {
    console.log(`${statusLabel('fail')} --phase <id> is required`);
    process.exitCode = 1;
    return null;
  }
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
  const phase = loaded.plan.phases.find((p) => p.id === phaseId);
  if (!phase) {
    console.log(`${statusLabel('fail')} no phase with id ${phaseId}`);
    process.exitCode = 1;
    return null;
  }
  return { plan: loaded.plan, phase };
}

export async function runReviewEmit(options: ReviewEmitOptions = {}): Promise<void> {
  const root = options.cwd ?? process.cwd();
  const found = await loadPhase(root, options.phase);
  if (!found) return;

  const signature = await worktreeSignature(root);
  const envelope = await buildReviewEnvelope(root, found.plan, found.phase, signature);

  if (options.json) {
    console.log(JSON.stringify(envelope, null, 2));
    return;
  }

  const pack = await buildContextPack(`${found.phase.title} review`, { cwd: root, limit: 5, budgetLines: 80 });
  const formattedPack = formatContextPack(pack, { budgetLines: 80 });

  console.log(brandTitle('agent-flow review (emit)'));
  console.log(keyValue('Phase:', `${envelope.phase.id} ${envelope.phase.title}`));
  console.log(keyValue('Goal:', envelope.phase.goal || '(none)'));
  console.log(keyValue('Requirements:', envelope.phase.requirements.join(', ') || '(none)'));
  console.log(section('Acceptance to verify:'));
  for (const a of envelope.acceptance) console.log(`  - [${a.taskId}] ${a.id} (${a.proof ?? 'manual'}): ${a.text}`);
  console.log(section('Scope files:'));
  console.log(`  ${envelope.scopeFiles.join(', ') || '(none)'}`);
  if (envelope.recentCommits.length > 0) {
    console.log(section('Recent commits:'));
    for (const c of envelope.recentCommits) console.log(`  ${c}`);
  }
  console.log(section('Review rubric (independent reviewer):'));
  for (const r of envelope.rubric) console.log(`  - ${r}`);
  console.log(section('Scoped context:'));
  console.log(formattedPack.trimEnd());
  console.log('');
  console.log(pc.bold('Hand this envelope to an independent reviewer agent, then record the verdict:'));
  console.log(`  ${pc.cyan(`agent-flow review record --phase ${envelope.phase.id} --verdict pass`)}  (or --verdict fail --notes "...")`);
}

export async function runReviewRecord(options: ReviewRecordOptions = {}): Promise<void> {
  const root = options.cwd ?? process.cwd();
  const found = await loadPhase(root, options.phase);
  if (!found) return;

  const verdict = options.verdict;
  if (verdict !== 'pass' && verdict !== 'fail') {
    console.log(`${statusLabel('fail')} --verdict must be "pass" or "fail"`);
    process.exitCode = 1;
    return;
  }

  const signature = await worktreeSignature(root);
  await writeReviewRecord(root, {
    phase: found.phase.id,
    signature,
    verdict: verdict as ReviewVerdict,
    notes: options.notes,
    at: new Date().toISOString(),
  });

  // Report the resulting gate status for clarity.
  const record = await readReviewRecord(root, found.phase.id);
  const status = reviewStatus(record, signature);

  if (options.json) {
    console.log(JSON.stringify({ phase: found.phase.id, verdict, status }, null, 2));
    return;
  }

  console.log(brandTitle('agent-flow review (record)'));
  console.log(`${verdict === 'pass' ? statusLabel('ok') : statusLabel('fail')} phase ${found.phase.id} review recorded: ${verdict}`);
  if (options.notes) console.log(keyValue('Notes:', options.notes));
  if (verdict === 'pass') {
    console.log(`Phase can now be closed: ${pc.cyan('agent-flow advance')} (its last task)`);
  } else {
    console.log('Address the findings, then re-emit and re-record the review.');
  }
}

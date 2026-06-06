import fs from 'fs-extra';
import pc from 'picocolors';
import { buildContextPack, formatContextPack } from '../core/context-pack.js';
import { worktreeSignature } from '../core/gates.js';
import { loadPlan } from '../core/plan.js';
import {
  buildReviewEnvelope,
  buildReviewerPrompt,
  parseReviewerVerdict,
  readReviewRecord,
  reviewStatus,
  writeReviewRecord,
  type ReviewVerdict,
} from '../core/review.js';
import type { Phase, Plan } from '../core/plan-schema.js';
import { brandTitle, keyValue, section, statusLabel } from '../core/terminal-ui.js';

export type ReviewEmitOptions = { cwd?: string; phase?: string; reviewer?: boolean; json?: boolean };
export type ReviewRecordOptions = { cwd?: string; phase?: string; verdict?: string; notes?: string; fromJson?: string; json?: boolean };

async function readSource(fromJson: string): Promise<string> {
  if (fromJson === '-') {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString('utf8');
  }
  return fs.readFile(fromJson, 'utf8');
}

/** Pull the last JSON object out of reviewer output (which may have prose around it). */
function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('no JSON object found in reviewer output');
  }
}

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
  const reviewerPrompt = buildReviewerPrompt(envelope);

  if (options.json) {
    console.log(JSON.stringify({ ...envelope, reviewerPrompt }, null, 2));
    return;
  }

  // --reviewer prints only the spawn-ready reviewer prompt (easy to pipe to an agent).
  if (options.reviewer) {
    console.log(reviewerPrompt);
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

  let verdict: ReviewVerdict;
  let notes = options.notes;

  if (options.fromJson) {
    let parsed;
    try {
      parsed = parseReviewerVerdict(extractJson(await readSource(options.fromJson)));
    } catch (err) {
      console.log(`${statusLabel('fail')} could not read reviewer verdict: ${(err as Error).message}`);
      process.exitCode = 1;
      return;
    }
    if (!parsed.ok) {
      console.log(`${statusLabel('fail')} invalid reviewer verdict: ${parsed.error}`);
      process.exitCode = 1;
      return;
    }
    verdict = parsed.verdict;
    notes = [parsed.notes, options.notes].filter(Boolean).join(' | ') || undefined;
  } else if (options.verdict === 'pass' || options.verdict === 'fail') {
    verdict = options.verdict;
  } else {
    console.log(`${statusLabel('fail')} provide --verdict pass|fail or --from-json <file|->`);
    process.exitCode = 1;
    return;
  }

  const signature = await worktreeSignature(root);
  await writeReviewRecord(root, {
    phase: found.phase.id,
    signature,
    verdict,
    notes,
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
  if (notes) console.log(keyValue('Notes:', notes));
  if (verdict === 'pass') {
    console.log(`Phase can now be closed: ${pc.cyan('agent-flow advance')} (its last task)`);
  } else {
    console.log('Address the findings, then re-emit and re-record the review.');
  }
}

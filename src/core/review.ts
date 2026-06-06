import path from 'node:path';
import fs from 'fs-extra';
import { execa } from 'execa';
import { readConfig } from './config.js';
import type { Phase, Plan } from './plan-schema.js';

/**
 * Tier-1 review: at a phase boundary agent-flow EMITS a review envelope (a
 * briefing for an independent reviewer); the host runtime spawns the reviewer.
 * The verdict is recorded keyed by the worktree signature, and closing the
 * phase via `advance` is gated on a passing verdict for the current code.
 *
 * agent-flow never spawns the reviewer itself — that keeps it runtime-agnostic.
 */

export type ReviewVerdict = 'pass' | 'fail';

export type ReviewRecord = {
  phase: string;
  signature: string;
  verdict: ReviewVerdict;
  notes?: string;
  at: string;
};

export type ReviewStatus = 'missing' | 'stale' | 'fail' | 'pass';

export async function getReviewTier(root: string): Promise<number> {
  const config = await readConfig(root);
  const orchestration = (config?.orchestration ?? {}) as { review?: { tier?: number } };
  const tier = orchestration.review?.tier;
  return typeof tier === 'number' ? tier : 0;
}

function reviewDir(root: string): string {
  return path.join(root, '.agent-flow', 'reviews');
}

export function reviewRecordPath(root: string, phaseId: string): string {
  return path.join(reviewDir(root), `${phaseId}.json`);
}

export async function writeReviewRecord(root: string, record: ReviewRecord): Promise<void> {
  const file = reviewRecordPath(root, record.phase);
  await fs.ensureDir(path.dirname(file));
  await fs.writeJson(file, record, { spaces: 2 });
}

export async function readReviewRecord(root: string, phaseId: string): Promise<ReviewRecord | null> {
  const file = reviewRecordPath(root, phaseId);
  if (!(await fs.pathExists(file))) return null;
  try {
    return (await fs.readJson(file)) as ReviewRecord;
  } catch {
    return null;
  }
}

export function reviewStatus(record: ReviewRecord | null, signature: string): ReviewStatus {
  if (!record) return 'missing';
  if (record.signature !== signature) return 'stale';
  if (record.verdict !== 'pass') return 'fail';
  return 'pass';
}

export function phaseScopeFiles(phase: Phase): string[] {
  const files = new Set<string>();
  for (const task of phase.tasks) {
    for (const file of task.scope) files.add(file);
  }
  return [...files].sort();
}

export type ReviewEnvelope = {
  phase: { id: string; title: string; goal: string; requirements: string[] };
  acceptance: Array<{ taskId: string; id: string; text: string; proof?: string }>;
  scopeFiles: string[];
  recentCommits: string[];
  rubric: string[];
  signature: string;
};

const REVIEW_RUBRIC = [
  'Every acceptance criterion is actually satisfied by the code (not just claimed).',
  'No scope creep: changes stay within the phase goal and scope files.',
  'Correctness risks and edge cases (error paths, races, boundaries) are handled.',
  'Tests genuinely exercise the acceptance criteria, not just happy paths.',
  'No security, data, or compatibility regressions introduced.',
];

/** A self-contained prompt for an independent reviewer agent to act on. */
export function buildReviewerPrompt(envelope: ReviewEnvelope): string {
  const lines = [
    `You are an independent code reviewer for phase ${envelope.phase.id} ("${envelope.phase.title}") of this project.`,
    `Phase goal: ${envelope.phase.goal || '(none stated)'}`,
    envelope.phase.requirements.length > 0 ? `Requirements: ${envelope.phase.requirements.join(', ')}` : '',
    '',
    'Verify each acceptance criterion against the ACTUAL code (read the scope files — do not trust claims):',
    ...envelope.acceptance.map((a) => `  - [${a.taskId}] ${a.id} (${a.proof ?? 'manual'}): ${a.text}`),
    '',
    `Scope files to read: ${envelope.scopeFiles.join(', ') || '(none listed)'}`,
    envelope.recentCommits.length > 0 ? `Recent commits:\n${envelope.recentCommits.map((c) => `  ${c}`).join('\n')}` : '',
    '',
    'Apply this rubric:',
    ...envelope.rubric.map((r) => `  - ${r}`),
    '',
    'Read the scope files, then judge whether the phase genuinely meets every acceptance criterion with no scope creep or correctness gaps.',
    'Return ONLY a JSON object on the last line, no prose around it:',
    '  {"verdict":"pass"|"fail","notes":"<one-line summary>","findings":["<issue>", ...]}',
    'Default to "fail" if any criterion is unmet, untested, or unclear.',
  ];
  return lines.filter((line) => line !== '').join('\n');
}

export function parseReviewerVerdict(
  value: unknown,
): { ok: true; verdict: ReviewVerdict; notes?: string } | { ok: false; error: string } {
  if (typeof value !== 'object' || value === null) return { ok: false, error: 'verdict is not an object' };
  const obj = value as { verdict?: unknown; notes?: unknown; findings?: unknown };
  if (obj.verdict !== 'pass' && obj.verdict !== 'fail') {
    return { ok: false, error: 'verdict must be "pass" or "fail"' };
  }
  const parts: string[] = [];
  if (typeof obj.notes === 'string' && obj.notes.trim()) parts.push(obj.notes.trim());
  if (Array.isArray(obj.findings)) {
    const findings = obj.findings.filter((f): f is string => typeof f === 'string' && f.trim().length > 0);
    if (findings.length > 0) parts.push(`findings: ${findings.join('; ')}`);
  }
  return { ok: true, verdict: obj.verdict, notes: parts.length > 0 ? parts.join(' | ') : undefined };
}

export async function buildReviewEnvelope(
  root: string,
  plan: Plan,
  phase: Phase,
  signature: string,
): Promise<ReviewEnvelope> {
  const acceptance = phase.tasks.flatMap((task) =>
    task.acceptance.map((a) => ({ taskId: task.id, id: a.id, text: a.text, proof: a.proof })),
  );

  const log = await execa('git', ['log', '--oneline', '-n', '10'], { cwd: root, reject: false });
  const recentCommits = typeof log.stdout === 'string' && log.stdout.trim()
    ? log.stdout.trim().split('\n')
    : [];

  return {
    phase: { id: phase.id, title: phase.title, goal: phase.goal, requirements: phase.requirements },
    acceptance,
    scopeFiles: phaseScopeFiles(phase),
    recentCommits,
    rubric: REVIEW_RUBRIC,
    signature,
  };
}

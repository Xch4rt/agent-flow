import pc from 'picocolors';
import {
  INPUT_EQUIVALENT_WEIGHTS,
  buildUsageReport,
  findTranscriptFiles,
  inputEquivalent as weightedInputEquivalent,
  parseSince,
  type UsageReport,
  type UsageTotals,
  type UsageWeights,
} from '../core/claude-usage.js';
import { buildCodexUsageReport, findCodexRolloutFiles } from '../core/codex-usage.js';
import { canReadCompressedRollouts } from '../core/codex-sessions.js';
import { resolveTargetAgent } from '../core/config.js';
import type { AgentId } from '../adapters/types.js';
import { brandTitle, keyValue, section, statusLabel } from '../core/terminal-ui.js';

export type UsageCmdOptions = {
  cwd?: string;
  /** claude | codex (default: the installed adapter, claude when both). */
  agent?: string;
  all?: boolean;
  since?: string;
  session?: string;
  dir?: string;
  top?: string | number;
  idleMinutes?: string | number;
  json?: boolean;
};

function positive(value: string | number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number.`);
  return parsed;
}

export function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

function pct(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '0%';
}

/** How each runtime names the four token kinds (Claude bills cache writes; OpenAI just bills uncached input). */
type Labels = { runtime: string; input: string; cacheWrite: string; cacheRead: string; cold: string; coldTitle: string; prefixHint: string; instructionsFile: string };

const LABELS: Record<AgentId, Labels> = {
  claude: {
    runtime: 'Claude Code transcripts',
    input: 'input',
    cacheWrite: 'cache write',
    cacheRead: 'cache read',
    cold: 'cache writes',
    coldTitle: 'Large cache writes',
    prefixHint: 'compaction, model switch, edited CLAUDE.md/tools, …',
    instructionsFile: 'CLAUDE.md',
  },
  codex: {
    runtime: 'Codex rollouts',
    input: 'uncached input',
    cacheWrite: 'cache write',
    cacheRead: 'cached input',
    cold: 'uncached re-reads',
    coldTitle: 'Large uncached re-reads',
    prefixHint: 'compaction, model switch, edited AGENTS.md/tools, …',
    instructionsFile: 'AGENTS.md',
  },
};

let activeWeights: UsageWeights = INPUT_EQUIVALENT_WEIGHTS;

function inputEquivalent(t: UsageTotals): number {
  return weightedInputEquivalent(t, activeWeights);
}

function totalsLine(t: UsageTotals, l: Labels): string {
  return `calls ${t.calls} · ${l.input} ${fmt(t.input)} · ${l.cacheWrite} ${fmt(t.cacheWrite)} · ${l.cacheRead} ${fmt(t.cacheRead)} · output ${fmt(t.output)} · ${pc.bold(`≈${fmt(inputEquivalent(t))} input-eq`)}`;
}

function weightsNote(w: UsageWeights, l: Labels): string {
  return `input-eq = ${l.input} + ${w.cacheWrite}×${l.cacheWrite} + ${w.cacheRead}×${l.cacheRead} + ${w.output}×output (API price ratios; a ranking aid, not your plan limit).`;
}

function avgContext(t: UsageTotals): number {
  return t.calls > 0 ? (t.input + t.cacheWrite + t.cacheRead) / t.calls : 0;
}

function shortTime(iso: string | undefined): string {
  if (!iso) return '?';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 16).replace('T', ' ');
}

function ranked(map: Record<string, UsageTotals>): Array<[string, UsageTotals]> {
  return Object.entries(map).sort((a, b) => inputEquivalent(b[1]) - inputEquivalent(a[1]));
}

export function formatUsageReport(report: UsageReport, top = 10): string {
  const lines: string[] = [];
  const l = LABELS[report.agent ?? 'claude'];
  activeWeights = report.weights ?? INPUT_EQUIVALENT_WEIGHTS;
  const all = inputEquivalent(report.totals);
  lines.push(brandTitle('agent-flow usage'));
  lines.push(keyValue('Source:', `${report.source} (${report.files} transcript file(s), ${report.sessions.length} session(s))`));
  lines.push(pc.dim(`Observed API usage from ${l.runtime}. ${weightsNote(activeWeights, l)}`));
  lines.push('');

  lines.push(section('Totals'));
  lines.push(`  ${totalsLine(report.totals, l)}`);
  const coldEq = report.agent === 'codex' ? report.totals.input * activeWeights.input : report.totals.cacheWrite * activeWeights.cacheWrite;
  lines.push(`  ${l.cold} are ${pct(coldEq, all)} of input-eq · ${l.cacheRead} ${pct(report.totals.cacheRead * activeWeights.cacheRead, all)} · output ${pct(report.totals.output * activeWeights.output, all)}`);
  lines.push('');

  lines.push(section('Main thread vs subagents'));
  lines.push(`  main       ${pct(inputEquivalent(report.main), all).padStart(4)}  ${totalsLine(report.main, l)}`);
  lines.push(`  subagents  ${pct(inputEquivalent(report.subagents), all).padStart(4)}  ${totalsLine(report.subagents, l)}`);
  lines.push(`  avg context per request: main ${fmt(avgContext(report.main))} · subagents ${fmt(avgContext(report.subagents))}  ${pc.dim('(what every turn re-reads)')}`);
  if (report.spawns > 0 || report.continuations > 0) {
    lines.push(`  subagents spawned ${report.spawns} · ${report.agent === 'codex' ? 'followup_task/send_message' : 'SendMessage'} continuations ${report.continuations}  ${pc.dim('(a continuation re-reads the agent\'s whole history)')}`);
  }
  lines.push('');

  const projects = Object.entries(report.byProject).sort((a, b) => inputEquivalent(b[1].totals) - inputEquivalent(a[1].totals));
  if (projects.length > 1) {
    lines.push(section('By project'));
    for (const [cwd, p] of projects.slice(0, top)) {
      lines.push(`  ${pct(inputEquivalent(p.totals), all).padStart(4)}  ${cwd}  ${pc.dim(`sessions ${p.sessions} · subagents ${pct(inputEquivalent(p.subagents), inputEquivalent(p.totals))} · peak ${fmt(p.peakContext)} · avg main ctx ${fmt(avgContext(p.main))} · idle rewrites ${fmt(p.idleRewriteTokens)}`)}`);
    }
    lines.push('');
  }

  const types = Object.entries(report.byAgentType).sort((a, b) => inputEquivalent(b[1].totals) - inputEquivalent(a[1].totals));
  if (types.length > 0) {
    lines.push(section('Subagents by type'));
    for (const [type, t] of types.slice(0, top)) {
      const perAgent = t.agents > 0 ? t.totals.calls / t.agents : 0;
      lines.push(`  ${pct(inputEquivalent(t.totals), all).padStart(4)}  ${type}  ${pc.dim(`agents ${t.agents} · ${Math.round(perAgent)} requests/agent · avg ctx ${fmt(avgContext(t.totals))} · peak ${fmt(t.peakContext)} · continuations ${t.continuations} · idle rewrites ${fmt(t.idleRewriteTokens)}`)}`);
    }
    lines.push('');
    lines.push(section(`Heaviest subagents (top ${Math.min(top, report.agents.length)})`));
    for (const a of report.agents.slice(0, top)) {
      lines.push(`  ${a.agentId.slice(0, 10)}  ${a.type}  ≈${fmt(inputEquivalent(a.totals))} input-eq · requests ${a.totals.calls} · peak ${fmt(a.peakContext)} · ${shortTime(a.first)} → ${shortTime(a.last)} · idle rewrites ${a.idleRewrites}${a.continuations ? ` · continuations ${a.continuations}` : ''}`);
    }
    lines.push('');
  }

  lines.push(section('By model'));
  for (const [model, t] of ranked(report.byModel)) {
    lines.push(`  ${pct(inputEquivalent(t), all).padStart(4)}  ${model}  ${pc.dim(totalsLine(t, l))}`);
  }
  lines.push('');

  lines.push(section('By skill / slash command (main thread) and agent type (subagents)'));
  for (const [skill, t] of ranked(report.bySkill).slice(0, top)) {
    lines.push(`  ${pct(inputEquivalent(t), all).padStart(4)}  ${skill}  ${pc.dim(`calls ${t.calls}, ≈${fmt(inputEquivalent(t))} input-eq`)}`);
  }
  lines.push('');

  lines.push(section(`Heaviest sessions (top ${Math.min(top, report.sessions.length)})`));
  for (const s of report.sessions.slice(0, top)) {
    const idle = s.cacheBreaks.filter((b) => b.reason === 'idle');
    const idleTokens = idle.reduce((sum, b) => sum + b.cacheWrite, 0);
    lines.push(`  ${s.sessionId.slice(0, 8)}  ${shortTime(s.start)} → ${shortTime(s.end)}  ≈${fmt(inputEquivalent(s.totals))} input-eq · peak context ${fmt(s.peakContext)} · calls ${s.totals.calls} · subagents ${pct(inputEquivalent(s.subagents), inputEquivalent(s.totals))} · cold-cache rewrites ${idle.length} (${fmt(idleTokens)})`);
    if (s.cwd) lines.push(`            ${pc.dim(s.cwd)}`);
  }
  lines.push('');

  const idle = report.cacheBreaks.filter((b) => b.reason === 'idle');
  const prefix = report.cacheBreaks.filter((b) => b.reason === 'prefix-change');
  const first = report.cacheBreaks.filter((b) => b.reason === 'first-request');
  const sum = (xs: typeof idle) => xs.reduce((acc, b) => acc + b.cacheWrite, 0);
  lines.push(section(l.coldTitle));
  lines.push(`  after idle gap     ${String(idle.length).padStart(4)}  ${fmt(sum(idle))} tokens  ${pc.dim('(cache expired while you were away → full context re-read uncached)')}`);
  lines.push(`  prefix changed     ${String(prefix.length).padStart(4)}  ${fmt(sum(prefix))} tokens  ${pc.dim(`(${l.prefixHint})`)}`);
  lines.push(`  first request      ${String(first.length).padStart(4)}  ${fmt(sum(first))} tokens  ${pc.dim('(session or subagent start)')}`);
  for (const b of report.cacheBreaks.filter((x) => x.reason !== 'first-request').slice(0, top)) {
    const gap = b.gapMinutes === null ? '' : ` after ${b.gapMinutes} min`;
    lines.push(`    ${shortTime(b.at)}  ${b.sessionId.slice(0, 8)}${b.sidechain ? ' (subagent)' : ''}  ${fmt(b.cacheWrite)} ${b.reason}${gap}`);
  }

  const peak = report.sessions.reduce((m, s) => Math.max(m, s.peakContext), 0);
  const signals: string[] = [];
  if (peak >= 200_000) signals.push(`a session reached ${fmt(peak)} tokens of context — every turn re-reads it; split work or /clear between tasks.`);
  if (sum(idle) > 0) signals.push(`${fmt(sum(idle))} tokens re-written after idle gaps — resume big sessions fresh instead of returning to them cold.`);
  if (inputEquivalent(report.subagents) > inputEquivalent(report.main)) signals.push('subagents outweigh the main thread — check their model and how much context each one loads.');
  const longLived = report.agents.filter((a) => a.peakContext >= 200_000);
  if (longLived.length > 0) signals.push(`${longLived.length} subagent(s) grew past 200k context — long-lived agents (${report.agent === 'codex' ? 'followup_task' : 'SendMessage'} loops) re-read their whole history every turn; prefer a fresh agent per round with only the artifact to review.`);
  if (signals.length > 0) {
    lines.push('');
    lines.push(section('Signals'));
    for (const signal of signals) lines.push(`  ${statusLabel('warning')} ${signal}`);
  }
  return lines.join('\n');
}

export async function runUsage(options: UsageCmdOptions = {}): Promise<void> {
  const since = parseSince(options.since);
  const top = positive(options.top, 10, '--top');
  const idleMinutes = positive(options.idleMinutes, 5, '--idle-minutes');
  const root = options.cwd ?? process.cwd();
  const agent = await resolveTargetAgent(root, options.agent);

  let source: string;
  let candidates: string[];
  let skippedCompressed = 0;
  if (agent === 'codex') {
    const found = await findCodexRolloutFiles({ projectPath: root, all: options.all, dir: options.dir, since });
    source = found.source;
    candidates = found.files;
    skippedCompressed = found.skippedCompressed;
  } else {
    const found = await findTranscriptFiles({ projectPath: root, all: options.all, dir: options.dir, since });
    source = found.source;
    candidates = found.files;
  }
  // Claude: a session's main transcript is <id>.jsonl and its subagents live under <id>/. Codex: the thread id is in the file name.
  const files = options.session ? candidates.filter((f) => f.includes(options.session as string)) : candidates;

  if (files.length === 0) {
    console.log(`${statusLabel('warning')} no ${LABELS[agent].runtime} found in ${source}${options.session ? ` for session ${options.session}` : ''}${options.all ? '' : ` for ${root}`}`);
    if (!options.all) console.log(`Try: ${pc.cyan(`agent-flow usage --agent ${agent} --all`)} to scan every project.`);
    if (skippedCompressed > 0) console.log(pc.dim(`${skippedCompressed} compressed rollout(s) skipped — reading .jsonl.zst needs Node ≥ 22.15.`));
    return;
  }

  const report = agent === 'codex'
    ? await buildCodexUsageReport(files, source, { since, idleMinutes })
    : await buildUsageReport(files, source, { since, idleMinutes });

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(formatUsageReport(report, top));
  if (skippedCompressed > 0 && !canReadCompressedRollouts()) {
    console.log(pc.dim(`${skippedCompressed} compressed rollout(s) skipped — reading .jsonl.zst needs Node ≥ 22.15.`));
  }
}

import pc from 'picocolors';
import {
  buildUsageReport,
  findTranscriptFiles,
  inputEquivalent,
  parseSince,
  type UsageReport,
  type UsageTotals,
} from '../core/claude-usage.js';
import { brandTitle, keyValue, section, statusLabel } from '../core/terminal-ui.js';

export type UsageCmdOptions = {
  cwd?: string;
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

function totalsLine(t: UsageTotals): string {
  return `calls ${t.calls} · input ${fmt(t.input)} · cache write ${fmt(t.cacheWrite)} · cache read ${fmt(t.cacheRead)} · output ${fmt(t.output)} · ${pc.bold(`≈${fmt(inputEquivalent(t))} input-eq`)}`;
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
  const all = inputEquivalent(report.totals);
  lines.push(brandTitle('agent-flow usage'));
  lines.push(keyValue('Source:', `${report.source} (${report.files} transcript file(s), ${report.sessions.length} session(s))`));
  lines.push(pc.dim('Observed API usage from Claude Code transcripts. input-eq = input + 1.25×cache write + 0.1×cache read + 5×output (API price ratios; a ranking aid, not your plan limit).'));
  lines.push('');

  lines.push(section('Totals'));
  lines.push(`  ${totalsLine(report.totals)}`);
  const writeEq = report.totals.cacheWrite * report.weights.cacheWrite;
  lines.push(`  cache writes are ${pct(writeEq, all)} of input-eq · cache reads ${pct(report.totals.cacheRead * report.weights.cacheRead, all)} · output ${pct(report.totals.output * report.weights.output, all)}`);
  lines.push('');

  lines.push(section('Main thread vs subagents'));
  lines.push(`  main       ${pct(inputEquivalent(report.main), all).padStart(4)}  ${totalsLine(report.main)}`);
  lines.push(`  subagents  ${pct(inputEquivalent(report.subagents), all).padStart(4)}  ${totalsLine(report.subagents)}`);
  lines.push('');

  lines.push(section('By model'));
  for (const [model, t] of ranked(report.byModel)) {
    lines.push(`  ${pct(inputEquivalent(t), all).padStart(4)}  ${model}  ${pc.dim(totalsLine(t))}`);
  }
  lines.push('');

  lines.push(section('By skill / slash command (main thread; subagents grouped)'));
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
  lines.push(section('Large cache writes'));
  lines.push(`  after idle gap     ${String(idle.length).padStart(4)}  ${fmt(sum(idle))} tokens  ${pc.dim('(cache expired while you were away → full context re-written)')}`);
  lines.push(`  prefix changed     ${String(prefix.length).padStart(4)}  ${fmt(sum(prefix))} tokens  ${pc.dim('(compaction, model switch, edited CLAUDE.md/tools, …)')}`);
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
  const found = await findTranscriptFiles({
    projectPath: options.cwd ?? process.cwd(),
    all: options.all,
    dir: options.dir,
    since,
  });
  const { source } = found;
  // A session's main transcript is <id>.jsonl and its subagents live under <id>/, so a path match covers both.
  const files = options.session ? found.files.filter((f) => f.includes(options.session as string)) : found.files;

  if (files.length === 0) {
    console.log(`${statusLabel('warning')} no Claude Code transcripts found in ${source}${options.session ? ` for session ${options.session}` : ''}`);
    if (!options.all) console.log(`Try: ${pc.cyan('agent-flow usage --all')} to scan every project.`);
    return;
  }

  const report = await buildUsageReport(files, source, { since, idleMinutes });

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(formatUsageReport(report, top));
}

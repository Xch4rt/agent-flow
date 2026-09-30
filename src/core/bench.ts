import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import fs from 'fs-extra';
import { buildUsageReport, findTranscriptFiles, inputEquivalent, type UsageTotals } from './claude-usage.js';
import { runCompact } from './run-compact.js';

/**
 * Reproducible A/B benchmarks for agent workflows (agent-flow vs GSD vs plain).
 *
 * A bench task is a folder:
 *   bench.json  { "check": "node --test hidden/", "setup"?: "npm install" }
 *   task.md     the prompt given to the agent
 *   seed/       starting repo
 *   hidden/     acceptance tests the agent never sees (copied in only at `finish`)
 *
 * agent-flow never drives the agent: `prepare` builds an isolated workspace,
 * you run the variant's workflow there, `finish` runs the hidden tests and reads
 * the tokens Claude Code recorded for that workspace. Each run has its own path,
 * so its transcripts — and its usage — are isolated by construction.
 */

export type BenchSpec = { name: string; check: string; setup?: string; prompt: string; seedDir: string; hiddenDir: string };

export type BenchRun = {
  task: string;
  taskDir: string;
  variant: string;
  runId: string;
  workspace: string;
  preparedAt: string;
  startedAt: string;
};

export type BenchResult = BenchRun & {
  finishedAt: string;
  wallMinutes: number;
  passed: boolean;
  check: { exitCode: number | null; summary?: string; failures: number; logPath: string };
  usage: {
    sessions: number;
    totals: UsageTotals;
    main: UsageTotals;
    subagents: UsageTotals;
    inputEq: number;
    peakContext: number;
    idleRewriteTokens: number;
    models: string[];
  };
};

export function defaultBenchDir(): string {
  return process.env.AGENT_FLOW_BENCH_DIR ?? path.join(os.homedir(), '.agent-flow-bench');
}

export async function loadBenchSpec(taskDir: string): Promise<BenchSpec> {
  const dir = path.resolve(taskDir);
  const configPath = path.join(dir, 'bench.json');
  if (!(await fs.pathExists(configPath))) throw new Error(`not a bench task (missing bench.json): ${dir}`);
  const config = (await fs.readJson(configPath)) as Record<string, unknown>;
  if (typeof config.check !== 'string' || !config.check.trim()) throw new Error(`bench.json needs a "check" command: ${configPath}`);
  const spec: BenchSpec = {
    name: typeof config.name === 'string' && config.name ? config.name : path.basename(dir),
    check: config.check,
    setup: typeof config.setup === 'string' && config.setup ? config.setup : undefined,
    prompt: path.join(dir, typeof config.prompt === 'string' ? config.prompt : 'task.md'),
    seedDir: path.join(dir, typeof config.seedDir === 'string' ? config.seedDir : 'seed'),
    hiddenDir: path.join(dir, typeof config.hiddenDir === 'string' ? config.hiddenDir : 'hidden'),
  };
  for (const [label, p] of [['prompt', spec.prompt], ['seed', spec.seedDir], ['hidden', spec.hiddenDir]] as const) {
    if (!(await fs.pathExists(p))) throw new Error(`bench task is missing its ${label}: ${p}`);
  }
  return spec;
}

function stamp(at: Date): string {
  return at.toISOString().replace(/[:.]/g, '-');
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execa('git', args, { cwd, env: { GIT_AUTHOR_NAME: 'bench', GIT_AUTHOR_EMAIL: 'bench@local', GIT_COMMITTER_NAME: 'bench', GIT_COMMITTER_EMAIL: 'bench@local' } });
}

export async function prepareBenchRun(taskDir: string, variant: string, options: { benchDir?: string; now?: Date } = {}): Promise<BenchRun & { setup?: string }> {
  if (!/^[\w.-]+$/.test(variant)) throw new Error('--variant must be letters, digits, dot, dash or underscore');
  const spec = await loadBenchSpec(taskDir);
  const now = options.now ?? new Date();
  const runId = `${variant}-${stamp(now)}`;
  const runDir = path.join(options.benchDir ?? defaultBenchDir(), spec.name, runId);
  const workspace = path.join(runDir, 'workspace');
  if (await fs.pathExists(runDir)) throw new Error(`run already exists: ${runDir}`);

  await fs.copy(spec.seedDir, workspace);
  await git(workspace, ['init', '-q']);
  await git(workspace, ['add', '-A']);
  await git(workspace, ['commit', '-q', '-m', 'bench seed', '--allow-empty']);

  let setup: string | undefined;
  if (spec.setup) {
    const run = await runCompact(workspace, spec.setup);
    setup = run.text;
    if (run.exitCode !== 0) throw new Error(`bench setup failed:\n${run.text}`);
  }

  const run: BenchRun = {
    task: spec.name,
    taskDir: path.resolve(taskDir),
    variant,
    runId,
    workspace,
    preparedAt: now.toISOString(),
    // Usage is counted from here; transcripts are isolated by the workspace path anyway.
    startedAt: new Date().toISOString(),
  };
  await fs.writeJson(path.join(runDir, 'run.json'), run, { spaces: 2 });
  return { ...run, setup };
}

export async function finishBenchRun(runDir: string, options: { claudeDir?: string; now?: Date } = {}): Promise<BenchResult> {
  const dir = path.resolve(runDir);
  const run = (await fs.readJson(path.join(dir, 'run.json'))) as BenchRun;
  const spec = await loadBenchSpec(run.taskDir);
  const finishedAt = options.now ?? new Date();

  // Hidden acceptance tests go in only now, after the agent is done.
  await fs.copy(spec.hiddenDir, run.workspace, { overwrite: true });
  const check = await runCompact(run.workspace, spec.check);

  const since = new Date(run.startedAt);
  const { files, source } = await findTranscriptFiles({ projectPath: run.workspace, dir: options.claudeDir, since });
  const report = await buildUsageReport(files, source, { since });
  const peakContext = report.sessions.reduce((m, s) => Math.max(m, s.peakContext), 0);
  const idleRewriteTokens = report.cacheBreaks.filter((b) => b.reason === 'idle').reduce((sum, b) => sum + b.cacheWrite, 0);

  // Wall time = the agent's active span (first → last request), not prepare → finish,
  // so preparing several runs up front does not inflate anyone's time.
  const starts = report.sessions.map((s) => Date.parse(s.start ?? '')).filter((t) => !Number.isNaN(t));
  const ends = report.sessions.map((s) => Date.parse(s.end ?? '')).filter((t) => !Number.isNaN(t));
  const activeMs = starts.length && ends.length ? Math.max(...ends) - Math.min(...starts) : finishedAt.getTime() - Date.parse(run.startedAt);

  const result: BenchResult = {
    ...run,
    finishedAt: finishedAt.toISOString(),
    wallMinutes: Math.round((activeMs / 60_000) * 10) / 10,
    passed: check.exitCode === 0,
    check: { exitCode: check.exitCode, summary: check.compact.summary, failures: check.compact.failures.length, logPath: path.join(run.workspace, check.logPath) },
    usage: {
      sessions: report.sessions.length,
      totals: report.totals,
      main: report.main,
      subagents: report.subagents,
      inputEq: inputEquivalent(report.totals),
      peakContext,
      idleRewriteTokens,
      models: Object.keys(report.byModel),
    },
  };
  await fs.writeJson(path.join(dir, 'result.json'), result, { spaces: 2 });
  return result;
}

export async function loadBenchResults(benchDir = defaultBenchDir(), task?: string): Promise<BenchResult[]> {
  const results: BenchResult[] = [];
  if (!(await fs.pathExists(benchDir))) return results;
  for (const taskName of await fs.readdir(benchDir)) {
    if (task && taskName !== task) continue;
    const taskPath = path.join(benchDir, taskName);
    if (!(await fs.stat(taskPath)).isDirectory()) continue;
    for (const runId of await fs.readdir(taskPath)) {
      const file = path.join(taskPath, runId, 'result.json');
      if (await fs.pathExists(file)) {
        try {
          results.push((await fs.readJson(file)) as BenchResult);
        } catch {
          // skip unreadable results
        }
      }
    }
  }
  return results;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export type BenchRow = {
  task: string;
  variant: string;
  runs: number;
  passRate: number;
  inputEq: number;
  cacheRead: number;
  peakContext: number;
  subagentShare: number;
  idleRewrites: number;
  wallMinutes: number;
};

export function summarizeBench(results: BenchResult[]): BenchRow[] {
  const groups = new Map<string, BenchResult[]>();
  for (const r of results) groups.set(`${r.task}\u0000${r.variant}`, [...(groups.get(`${r.task}\u0000${r.variant}`) ?? []), r]);
  const rows: BenchRow[] = [];
  for (const [key, rs] of groups) {
    const [task, variant] = key.split('\u0000');
    rows.push({
      task,
      variant,
      runs: rs.length,
      passRate: rs.filter((r) => r.passed).length / rs.length,
      inputEq: median(rs.map((r) => r.usage.inputEq)),
      cacheRead: median(rs.map((r) => r.usage.totals.cacheRead)),
      peakContext: median(rs.map((r) => r.usage.peakContext)),
      subagentShare: median(rs.map((r) => (r.usage.inputEq > 0 ? inputEquivalent(r.usage.subagents) / r.usage.inputEq : 0))),
      idleRewrites: median(rs.map((r) => r.usage.idleRewriteTokens)),
      wallMinutes: median(rs.map((r) => r.wallMinutes)),
    });
  }
  return rows.sort((a, b) => a.task.localeCompare(b.task) || a.inputEq - b.inputEq);
}

function k(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(Math.round(n));
}

/** Markdown table (medians per task × variant); the cheapest passing variant per task is the baseline for "vs best". */
export function formatBenchMarkdown(rows: BenchRow[]): string {
  const lines = [
    '| Task | Variant | Runs | Pass | Tokens (input-eq) | vs best | Cache reads | Peak context | Subagents | Wall (min) |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  const tasks = [...new Set(rows.map((r) => r.task))];
  for (const task of tasks) {
    const taskRows = rows.filter((r) => r.task === task);
    const passing = taskRows.filter((r) => r.passRate > 0);
    const best = Math.min(...(passing.length ? passing : taskRows).map((r) => r.inputEq));
    for (const r of taskRows) {
      const vs = best > 0 ? `${Math.round((r.inputEq / best) * 100)}%` : '—';
      lines.push(`| ${r.task} | ${r.variant} | ${r.runs} | ${Math.round(r.passRate * 100)}% | ${k(r.inputEq)} | ${vs} | ${k(r.cacheRead)} | ${k(r.peakContext)} | ${Math.round(r.subagentShare * 100)}% | ${r.wallMinutes} |`);
    }
  }
  lines.push('', '_Medians per task × variant. Tokens from Claude Code transcripts (input-eq = input + 1.25×cache write + 0.1×cache read + 5×output). Pass = hidden acceptance tests the agent never saw._');
  return lines.join('\n');
}

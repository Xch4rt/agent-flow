import path from 'node:path';
import fs from 'fs-extra';
import pc from 'picocolors';
import {
  defaultBenchDir,
  discardBenchRun,
  finishBenchRun,
  formatBenchMarkdown,
  loadBenchResults,
  loadBenchSpec,
  prepareBenchRun,
  summarizeBench,
} from '../core/bench.js';
import { brandTitle, keyValue, section, statusLabel } from '../core/terminal-ui.js';

export async function runBenchPrepare(taskDir: string, options: { variant: string; dir?: string; json?: boolean }): Promise<void> {
  const run = await prepareBenchRun(taskDir, options.variant, { benchDir: options.dir });
  const runDir = path.dirname(run.workspace);
  if (options.json) {
    console.log(JSON.stringify({ ...run, runDir }));
    return;
  }
  const spec = await loadBenchSpec(taskDir);
  console.log(brandTitle('agent-flow bench prepare'));
  console.log(keyValue('Task:', `${run.task} (variant ${run.variant})`));
  console.log(keyValue('Workspace:', run.workspace));
  if (run.setup) console.log(keyValue('Setup:', run.setup));
  console.log(section('Now:'));
  console.log(`  1) ${pc.cyan(`cd ${run.workspace} && claude`)}`);
  console.log(`  2) run the "${run.variant}" workflow on this prompt (${path.relative(process.cwd(), spec.prompt) || spec.prompt}) — same model for every variant`);
  console.log(`  3) when the agent is done, exit Claude and from a normal terminal run: ${pc.cyan(`agent-flow bench finish ${runDir}`)}`);
  console.log(pc.dim('Hidden acceptance tests are copied in only at finish; the agent never sees them.'));
  console.log(pc.dim('Do not run finish from a Claude session inside the workspace: that session\'s tokens would be counted for the variant.'));
}

export async function runBenchFinish(runDir: string, options: { json?: boolean; force?: boolean } = {}): Promise<void> {
  let result;
  try {
    result = await finishBenchRun(runDir, { force: options.force });
  } catch (error) {
    console.log(`${statusLabel('fail')} ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }
  if (options.json) {
    console.log(JSON.stringify(result));
    return;
  }
  console.log(brandTitle('agent-flow bench finish'));
  console.log(keyValue('Run:', `${result.task} / ${result.variant} (${result.wallMinutes} min)`));
  console.log(`${result.passed ? statusLabel('ok') : statusLabel('fail')} hidden tests${result.check.summary ? ` — ${result.check.summary}` : ''}`);
  if (!result.passed) console.log(keyValue('Log:', result.check.logPath));
  const u = result.usage;
  console.log(keyValue('Tokens:', `≈${u.inputEq.toLocaleString()} input-eq · cache read ${u.totals.cacheRead.toLocaleString()} · peak context ${u.peakContext.toLocaleString()} · ${u.sessions} session(s)`));
  if (u.sessions === 0) console.log(pc.yellow('No Claude Code transcripts found for this workspace — was the agent started inside it?'));
  console.log(`Report: ${pc.cyan('agent-flow bench report')}`);
}

export async function runBenchDiscard(runDir: string): Promise<void> {
  await discardBenchRun(runDir);
  console.log(`${statusLabel('ok')} discarded ${runDir}`);
}

export async function runBenchReport(options: { dir?: string; task?: string; json?: boolean; out?: string } = {}): Promise<void> {
  const dir = options.dir ?? defaultBenchDir();
  const rows = summarizeBench(await loadBenchResults(dir, options.task));
  if (options.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  if (rows.length === 0) {
    console.log(`${statusLabel('warning')} no finished bench runs in ${dir}`);
    return;
  }
  const markdown = formatBenchMarkdown(rows);
  if (options.out) {
    await fs.outputFile(options.out, `${markdown}\n`);
    console.log(`${statusLabel('ok')} wrote ${options.out}`);
    return;
  }
  console.log(markdown);
}

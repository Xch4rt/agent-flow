import path from 'node:path';
import { execa } from 'execa';
import fs from 'fs-extra';
import { compactOutput, formatCompact, stripAnsi, type CompactOutput } from './compact-output.js';

export const LOG_DIR_RELATIVE = path.join('.agent-flow', 'logs');
const KEEP_LOGS = 30;

export type CompactRun = {
  command: string;
  exitCode: number | null;
  durationMs: number;
  /** Repo-relative path of the full log. */
  logPath: string;
  compact: CompactOutput;
  /** What an agent should read. */
  text: string;
};

function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'cmd';
}

async function pruneLogs(dir: string): Promise<void> {
  try {
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.log')).sort();
    for (const file of files.slice(0, Math.max(0, files.length - KEEP_LOGS))) await fs.remove(path.join(dir, file));
  } catch {
    // best-effort
  }
}

export async function writeLog(root: string, label: string, content: string, at = new Date()): Promise<string> {
  const dir = path.join(root, LOG_DIR_RELATIVE);
  await fs.ensureDir(dir);
  const name = `${at.toISOString().replace(/[:.]/g, '-')}-${slug(label)}.log`;
  await fs.writeFile(path.join(dir, name), content);
  await pruneLogs(dir);
  return path.join(LOG_DIR_RELATIVE, name);
}

export function renderRun(run: Omit<CompactRun, 'text'>, options: { maxFailures?: number } = {}): string {
  const seconds = (run.durationMs / 1000).toFixed(1);
  const status = run.exitCode === 0 ? 'ok' : `exit ${run.exitCode ?? '?'}`;
  if (run.exitCode === 0) {
    const detail = run.compact.summary ? `${run.compact.tool}: ${run.compact.summary}` : run.compact.tail.at(-1) ?? '';
    return `${status} · ${seconds}s${detail ? ` · ${detail}` : ''}`;
  }
  return [`${status} · ${seconds}s · ${run.command}`, formatCompact(run.compact, options), `full log: ${run.logPath}`].join('\n');
}

export async function runCompact(root: string, command: string, options: { maxFailures?: number } = {}): Promise<CompactRun> {
  const started = Date.now();
  const result = await execa(command, { cwd: root, shell: true, reject: false, all: true });
  const durationMs = Date.now() - started;
  const all = typeof result.all === 'string' ? result.all : '';
  const logPath = await writeLog(root, command, `$ ${command}\n# exit ${result.exitCode ?? '?'} in ${durationMs}ms\n\n${stripAnsi(all)}`);
  const base = { command, exitCode: result.exitCode ?? null, durationMs, logPath, compact: compactOutput(all) };
  return { ...base, text: renderRun(base, options) };
}

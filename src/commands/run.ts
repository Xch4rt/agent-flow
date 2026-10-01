import { runCompact } from '../core/run-compact.js';

export type RunCmdOptions = { cwd?: string; maxFailures?: string | number; json?: boolean };

function shellQuote(arg: string): string {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** `agent-flow run -- <cmd>`: run a noisy command, print only what an agent needs, keep the full log on disk. */
export async function runRunCommand(parts: string[], options: RunCmdOptions = {}): Promise<void> {
  const root = options.cwd ?? process.cwd();
  if (parts.length === 0) throw new Error('usage: agent-flow run -- <command> [args...]');
  const command = parts.length === 1 ? parts[0] : parts.map(shellQuote).join(' ');
  const maxFailures = options.maxFailures === undefined ? undefined : Number(options.maxFailures);
  const run = await runCompact(root, command, { maxFailures });
  if (options.json) {
    console.log(JSON.stringify({ command: run.command, exitCode: run.exitCode, durationMs: run.durationMs, logPath: run.logPath, tool: run.compact.tool, summary: run.compact.summary, failures: run.compact.failures }));
  } else {
    console.log(run.text);
  }
  process.exitCode = run.exitCode ?? 1;
}

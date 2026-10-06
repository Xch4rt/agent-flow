import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'fs-extra';
import { execa } from 'execa';
import { readConfig } from './config.js';
import { detectProject } from './detect-project.js';
import { getSmokeConfig, runSmoke } from './smoke.js';
import { compactOutput, formatCompact } from './compact-output.js';
import { writeLog } from './run-compact.js';

export type GateResult = {
  name: string;
  command: string | null;
  ok: boolean;
  exitCode: number | null;
  outputTail: string;
  skipped: boolean;
};

export type GateRun = { ok: boolean; results: GateResult[] };

const GATE_CACHE_RELATIVE = path.join('.agent-flow', 'gate-cache.json');

/** Resolve named gates → shell commands: config.orchestration.gates wins over detection. */
export async function resolveGateCommands(root: string): Promise<Record<string, string>> {
  const detection = await detectProject(root);
  const fromDetection: Record<string, string> = {};
  for (const key of ['test', 'typecheck', 'lint', 'build'] as const) {
    const command = detection.commands[key];
    if (command) fromDetection[key] = command;
  }

  const config = await readConfig(root);
  const orchestration = (config?.orchestration ?? {}) as { gates?: Record<string, string> };
  const fromConfig = orchestration.gates ?? {};

  return { ...fromDetection, ...fromConfig };
}

export async function getDefaultGates(root: string): Promise<string[]> {
  const config = await readConfig(root);
  const orchestration = (config?.orchestration ?? {}) as { defaultGates?: string[] };
  return orchestration.defaultGates ?? ['test'];
}

export async function getStrictGates(root: string): Promise<boolean> {
  const config = await readConfig(root);
  const orchestration = (config?.orchestration ?? {}) as { strictGates?: boolean };
  return orchestration.strictGates === true;
}

export type RunGateOptions = { strict?: boolean };

export async function runGate(
  root: string,
  name: string,
  commands: Record<string, string>,
  options: RunGateOptions = {},
): Promise<GateResult> {
  const command = commands[name];

  // Built-in smoke gate: boot the app and probe it for real (unless a shell
  // command override is configured for "smoke").
  if (name === 'smoke' && !command) {
    const smokeConfig = await getSmokeConfig(root);
    if (smokeConfig) {
      const result = await runSmoke(root, smokeConfig);
      return {
        name,
        command: '(built-in smoke)',
        ok: result.ok,
        exitCode: result.ok ? 0 : 1,
        outputTail: [result.summary, ...result.steps.map((s) => `  ${s.ok ? 'ok' : 'FAIL'} ${s.name}: ${s.detail}`)].join('\n'),
        skipped: false,
      };
    }
  }

  if (!command) {
    return {
      name,
      command: null,
      // In strict mode an unresolved gate fails instead of being skipped.
      ok: !options.strict,
      exitCode: null,
      outputTail: `no command resolved for gate "${name}"${options.strict ? ' — strict: failing' : ' — skipped'}`,
      skipped: !options.strict,
    };
  }

  const result = await execa(command, { cwd: root, shell: true, reject: false, all: true });
  const all = typeof result.all === 'string' ? result.all : '';
  // Agents read this: keep only the failures (parsed per tool), full log on disk.
  let outputTail: string;
  if (result.exitCode === 0) {
    outputTail = all.trim().split('\n').slice(-3).join('\n');
  } else {
    const logPath = await writeLog(root, `gate-${name}`, `$ ${command}\n# exit ${result.exitCode ?? '?'}\n\n${all}`).catch(() => null);
    outputTail = [formatCompact(compactOutput(all)), logPath ? `full log: ${logPath}` : ''].filter(Boolean).join('\n');
  }

  return {
    name,
    command,
    ok: result.exitCode === 0,
    exitCode: result.exitCode ?? null,
    outputTail,
    skipped: false,
  };
}

export async function runGates(root: string, names: string[], options: RunGateOptions = {}): Promise<GateRun> {
  const commands = await resolveGateCommands(root);
  const results: GateResult[] = [];
  for (const name of names) {
    results.push(await runGate(root, name, commands, options));
  }
  return { ok: results.every((r) => r.ok), results };
}

/**
 * Parses `git status --porcelain=v1 -z` into root-relative paths. `prefix` is
 * `git rev-parse --show-prefix` (empty when root is the git toplevel). Renames
 * and copies carry the original path as an extra NUL field, which is skipped.
 */
export function parsePorcelainZ(output: string, prefix: string): Array<{ code: string; path: string }> {
  const fields = output.split('\0');
  const result: Array<{ code: string; path: string }> = [];
  for (let i = 0; i < fields.length; i += 1) {
    const field = fields[i];
    if (!field || field.length < 4) continue;
    const code = field.slice(0, 2);
    const full = field.slice(3);
    if (code.includes('R') || code.includes('C')) i += 1; // skip the original path
    if (!full.startsWith(prefix)) continue;
    const relative = full.slice(prefix.length);
    if (relative) result.push({ code, path: relative });
  }
  return result;
}

/**
 * A content signature of the working tree, so a cached gate result can be tied
 * to the exact code it ran against. Best-effort outside a git repo.
 */
export async function worktreeSignature(root: string): Promise<string> {
  const hash = crypto.createHash('sha256');

  const head = await execa('git', ['rev-parse', 'HEAD'], { cwd: root, reject: false });
  hash.update(typeof head.stdout === 'string' ? head.stdout : '');

  // Scope to the project root: in a monorepo the root may sit below the git
  // toplevel, and porcelain paths are toplevel-relative. `-- .` limits status to
  // the project; stripping `--show-prefix` makes paths root-relative. `-z` avoids
  // C-style quoting of unusual paths.
  const prefixResult = await execa('git', ['rev-parse', '--show-prefix'], { cwd: root, reject: false });
  const prefix = typeof prefixResult.stdout === 'string' ? prefixResult.stdout.trim() : '';
  const status = await execa('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.'], {
    cwd: root,
    reject: false,
  });
  const relativePaths = parsePorcelainZ(typeof status.stdout === 'string' ? status.stdout : '', prefix);

  // Exclude agent-flow's own generated bookkeeping (plan.json, gate-cache.json,
  // reviews, memory index) so the signature tracks SOURCE changes, not orchestration writes.
  const isIgnoredForSignature = (relative: string): boolean =>
    relative.startsWith('.agent-flow/') || relative.startsWith('.memory/');

  const entries = relativePaths.filter((entry) => !isIgnoredForSignature(entry.path));
  hash.update(entries.map((entry) => `${entry.code} ${entry.path}`).join('\n'));

  for (const entry of entries) {
    const filePath = path.join(root, entry.path);
    try {
      if ((await fs.pathExists(filePath)) && (await fs.stat(filePath)).isFile()) {
        hash.update(await fs.readFile(filePath));
      }
    } catch {
      // ignore unreadable files
    }
  }

  return hash.digest('hex');
}

export type GateCache = {
  task: string;
  signature: string;
  ok: boolean;
  gates: string[];
  at: string;
};

export function gateCachePath(root: string): string {
  return path.join(root, GATE_CACHE_RELATIVE);
}

export async function writeGateCache(root: string, cache: GateCache): Promise<void> {
  const file = gateCachePath(root);
  await fs.ensureDir(path.dirname(file));
  await fs.writeJson(file, cache, { spaces: 2 });
}

export async function readGateCache(root: string): Promise<GateCache | null> {
  const file = gateCachePath(root);
  if (!(await fs.pathExists(file))) return null;
  try {
    return (await fs.readJson(file)) as GateCache;
  } catch {
    return null;
  }
}

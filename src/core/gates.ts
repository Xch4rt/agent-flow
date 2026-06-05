import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'fs-extra';
import { execa } from 'execa';
import { readConfig } from './config.js';
import { detectProject } from './detect-project.js';
import { getSmokeConfig, runSmoke } from './smoke.js';

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
  const outputTail = all.trim().split('\n').slice(-12).join('\n');

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
 * A content signature of the working tree, so a cached gate result can be tied
 * to the exact code it ran against. Best-effort outside a git repo.
 */
export async function worktreeSignature(root: string): Promise<string> {
  const hash = crypto.createHash('sha256');

  const head = await execa('git', ['rev-parse', 'HEAD'], { cwd: root, reject: false });
  hash.update(typeof head.stdout === 'string' ? head.stdout : '');

  const status = await execa('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: root, reject: false });
  const porcelain = typeof status.stdout === 'string' ? status.stdout : '';

  // Exclude agent-flow's own generated bookkeeping (plan.json, gate-cache.json,
  // memory index) so the signature tracks SOURCE changes, not orchestration writes.
  const isIgnoredForSignature = (relative: string): boolean =>
    relative.startsWith('.agent-flow/') || relative.startsWith('.memory/');

  const lines = porcelain
    .split('\n')
    .filter((line) => {
      const entry = line.slice(3).trim();
      if (!entry) return false;
      const relative = entry.includes(' -> ') ? entry.split(' -> ')[1] : entry;
      return !isIgnoredForSignature(relative);
    });

  hash.update(lines.join('\n'));

  for (const line of lines) {
    const entry = line.slice(3).trim();
    const relative = entry.includes(' -> ') ? entry.split(' -> ')[1] : entry;
    const filePath = path.join(root, relative);
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

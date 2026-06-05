import fs from 'node:fs';
import path from 'node:path';

/**
 * Walk up from `start` to find the nearest ancestor that is an agent-flow
 * project (has `.agent-flow/config.json`). Returns null if none is found.
 */
export function findProjectRoot(start: string): string | null {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.agent-flow', 'config.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Resolve the effective project root. Precedence:
 *   1. an explicit --root flag, 2. AGENT_FLOW_ROOT env,
 *   3. the nearest ancestor agent-flow project, 4. the current directory.
 */
export function resolveRoot(opts: { rootFlag?: string; env?: string; cwd?: string } = {}): string {
  const cwd = opts.cwd ?? process.cwd();
  if (opts.rootFlag) return path.resolve(cwd, opts.rootFlag);
  if (opts.env) return path.resolve(cwd, opts.env);
  return findProjectRoot(cwd) ?? cwd;
}

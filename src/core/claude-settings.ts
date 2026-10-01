import path from 'node:path';
import fs from 'fs-extra';
import type { WriteResult } from './write-file-safe.js';

/** Hook commands degrade to a no-op when agent-flow is not on PATH (teammates, CI). */
export const GUARD_PROMPT_COMMAND = 'command -v agent-flow >/dev/null 2>&1 && agent-flow guard prompt || true';
export const GUARD_TOOL_COMMAND = 'command -v agent-flow >/dev/null 2>&1 && agent-flow guard tool || true';

type HookEntry = { matcher?: string; hooks?: Array<{ type?: string; command?: string }> };

function hasGuard(entries: unknown): boolean {
  return Array.isArray(entries) && entries.some((entry: HookEntry) =>
    Array.isArray(entry?.hooks) && entry.hooks.some((h) => typeof h?.command === 'string' && h.command.includes('agent-flow guard')));
}

/**
 * Merge the agent-flow session guard into .claude/settings.json without touching
 * anything else in the file. Idempotent.
 */
export async function installGuardHook(root: string): Promise<WriteResult> {
  const file = path.join(root, '.claude', 'settings.json');
  const exists = await fs.pathExists(file);
  let settings: Record<string, unknown> = {};
  if (exists) {
    try {
      const parsed = await fs.readJson(file);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) settings = parsed;
      else return { path: file, status: 'skipped' };
    } catch {
      // Unparseable settings (comments, typos): never overwrite the user's file.
      return { path: file, status: 'skipped' };
    }
  }
  const hooks = (settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {}) as Record<string, unknown>;
  if (hasGuard(hooks.UserPromptSubmit)) return { path: file, status: 'skipped' };

  const current = Array.isArray(hooks.UserPromptSubmit) ? hooks.UserPromptSubmit : [];
  hooks.UserPromptSubmit = [...current, { hooks: [{ type: 'command', command: GUARD_PROMPT_COMMAND }] }];
  settings.hooks = hooks;
  await fs.ensureDir(path.dirname(file));
  await fs.writeFile(file, `${JSON.stringify(settings, null, 2)}\n`);
  return { path: file, status: exists ? 'overwritten' : 'created' };
}

export async function guardHookInstalled(root: string): Promise<boolean> {
  try {
    const settings = await fs.readJson(path.join(root, '.claude', 'settings.json'));
    return hasGuard(settings?.hooks?.UserPromptSubmit);
  } catch {
    return false;
  }
}

export const GITIGNORE_ENTRIES = [
  '.agent-flow/memory.db',
  '.agent-flow/logs/',
  '.agent-flow/handoffs/',
  '.agent-flow/review-*.prompt.md',
  '.agent-flow/review-*.verdict.json',
  '.agent-flow/harden.*',
  '.agent-flow/task-stats.json',
  '.agent-flow/gate-cache.json',
  '.agent-flow/guard-state.json',
  '.agent-flow/bench/',
];

/** Append agent-flow's generated scratch paths to .gitignore (only the missing ones). */
export async function ensureGitignore(root: string): Promise<WriteResult> {
  const file = path.join(root, '.gitignore');
  const exists = await fs.pathExists(file);
  const content = exists ? await fs.readFile(file, 'utf8') : '';
  const present = new Set(content.split(/\r?\n/).map((l) => l.trim()));
  const missing = GITIGNORE_ENTRIES.filter((entry) => !present.has(entry));
  if (missing.length === 0) return { path: file, status: 'skipped' };
  const block = `${content && !content.endsWith('\n') ? '\n' : ''}${content ? '\n' : ''}# agent-flow scratch (generated)\n${missing.join('\n')}\n`;
  await fs.writeFile(file, content + block);
  return { path: file, status: exists ? 'overwritten' : 'created' };
}

export async function missingGitignoreEntries(root: string): Promise<string[]> {
  try {
    const present = new Set((await fs.readFile(path.join(root, '.gitignore'), 'utf8')).split(/\r?\n/).map((l) => l.trim()));
    return GITIGNORE_ENTRIES.filter((e) => !present.has(e));
  } catch {
    return [...GITIGNORE_ENTRIES];
  }
}

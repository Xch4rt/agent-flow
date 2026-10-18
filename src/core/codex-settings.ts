import path from 'node:path';
import fs from 'fs-extra';
import { GUARD_PROMPT_COMMAND, GUARD_TOOL_COMMAND } from './claude-settings.js';
import type { WriteResult } from './write-file-safe.js';

/**
 * Project-level Codex configuration that agent-flow owns:
 *
 * - `.codex/hooks.json` — lifecycle hooks (same JSON shape as Claude Code's).
 *   Codex loads them only for trusted projects, and each hook must be trusted
 *   once in `/hooks` before it runs; until then it is skipped, never fatal.
 * - `.codex/agents/*.toml` — custom agent roles (installed by the adapter).
 * - `.agents/skills/<name>/SKILL.md` — repo skills (installed by the adapter).
 */

export const CODEX_HOOKS_RELATIVE = path.join('.codex', 'hooks.json');

type HookEntry = { matcher?: string; hooks?: Array<{ type?: string; command?: string }> };

function hasGuard(entries: unknown, needle: string): boolean {
  return Array.isArray(entries) && entries.some((entry: HookEntry) =>
    Array.isArray(entry?.hooks) && entry.hooks.some((h) => typeof h?.command === 'string' && h.command.includes(needle)));
}

/**
 * Merge the agent-flow session guard into `.codex/hooks.json` without touching
 * anything else in the file. Idempotent. The PreToolUse hook runs for every
 * tool call in the project but only acts inside `flow_executor*` subagents
 * (it reads `agent_type` from the hook input).
 */
export async function installCodexHooks(root: string): Promise<WriteResult> {
  const file = path.join(root, CODEX_HOOKS_RELATIVE);
  const exists = await fs.pathExists(file);
  let settings: Record<string, unknown> = {};
  if (exists) {
    try {
      const parsed = await fs.readJson(file);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) settings = parsed;
      else return { path: file, status: 'skipped' };
    } catch {
      // Unparseable: never overwrite the user's file.
      return { path: file, status: 'skipped' };
    }
  }
  const hooks = (settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {}) as Record<string, unknown>;
  const promptInstalled = hasGuard(hooks.UserPromptSubmit, 'agent-flow guard prompt');
  const toolInstalled = hasGuard(hooks.PreToolUse, 'agent-flow guard tool');
  if (promptInstalled && toolInstalled) return { path: file, status: 'skipped' };

  if (!promptInstalled) {
    const current = Array.isArray(hooks.UserPromptSubmit) ? hooks.UserPromptSubmit : [];
    hooks.UserPromptSubmit = [...current, { hooks: [{ type: 'command', command: GUARD_PROMPT_COMMAND, statusMessage: 'agent-flow guard', timeout: 10 }] }];
  }
  if (!toolInstalled) {
    const current = Array.isArray(hooks.PreToolUse) ? hooks.PreToolUse : [];
    hooks.PreToolUse = [...current, { hooks: [{ type: 'command', command: GUARD_TOOL_COMMAND, statusMessage: 'agent-flow guard', timeout: 10 }] }];
  }
  settings.hooks = hooks;
  await fs.ensureDir(path.dirname(file));
  await fs.writeFile(file, `${JSON.stringify(settings, null, 2)}\n`);
  return { path: file, status: exists ? 'overwritten' : 'created' };
}

export async function codexHooksInstalled(root: string): Promise<{ prompt: boolean; tool: boolean }> {
  try {
    const settings = await fs.readJson(path.join(root, CODEX_HOOKS_RELATIVE));
    return {
      prompt: hasGuard(settings?.hooks?.UserPromptSubmit, 'agent-flow guard prompt'),
      tool: hasGuard(settings?.hooks?.PreToolUse, 'agent-flow guard tool'),
    };
  } catch {
    return { prompt: false, tool: false };
  }
}

/**
 * Skills agent-flow ≤0.9 wrote to `.codex/skills/` (a deprecated location).
 * Codex still discovers them in trusted projects, so a migrated repo would
 * list every `flow-*` skill twice; `doctor` asks to delete them.
 */
export async function legacyCodexSkillDirs(root: string): Promise<string[]> {
  const dir = path.join(root, '.codex', 'skills');
  if (!(await fs.pathExists(dir))) return [];
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith('flow-') && (await fs.pathExists(path.join(dir, entry.name, 'SKILL.md')))) {
      out.push(path.join('.codex', 'skills', entry.name));
    }
  }
  return out.sort();
}

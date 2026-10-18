import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import type { AgentId } from '../adapters/types.js';

/**
 * Which agent runtimes are set up on this machine, judged by their home
 * folders: Claude Code (`$CLAUDE_CONFIG_DIR` or `~/.claude`) and Codex
 * (`$CODEX_HOME` or `~/.codex`). Used to suggest (interactive) or pick
 * (non-interactive) what `agent-flow init` installs when no flag says.
 */
export function runtimeHomes(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): Record<AgentId, string> {
  return {
    claude: env.CLAUDE_CONFIG_DIR ?? path.join(home, '.claude'),
    codex: env.CODEX_HOME ?? path.join(home, '.codex'),
  };
}

export async function detectInstalledRuntimes(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): Promise<AgentId[]> {
  const homes = runtimeHomes(env, home);
  const found: AgentId[] = [];
  // Order matches `--agent all`: codex, claude.
  for (const id of ['codex', 'claude'] as const) {
    if (await fs.pathExists(homes[id])) found.push(id);
  }
  return found;
}

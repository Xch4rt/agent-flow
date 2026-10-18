import path from 'node:path';
import fs from 'fs-extra';
import type { AgentId } from '../adapters/types.js';

type AgentFlowConfig = {
  schemaVersion?: number;
  adapters?: Record<string, boolean>;
  agent?: string;
  [key: string]: unknown;
};

export async function readConfig(root: string): Promise<AgentFlowConfig | null> {
  const configPath = path.join(root, '.agent-flow', 'config.json');
  if (!(await fs.pathExists(configPath))) return null;
  try {
    return await fs.readJson(configPath) as AgentFlowConfig;
  } catch {
    return null;
  }
}

export async function readInstalledAdapters(root: string): Promise<AgentId[]> {
  const config = await readConfig(root);
  if (!config) return [];

  const ids: AgentId[] = [];

  if (config.adapters) {
    if (config.adapters.codex) ids.push('codex');
    if (config.adapters.claude) ids.push('claude');
  } else if (config.agent === 'codex') {
    ids.push('codex');
  }

  return ids;
}

/**
 * Which agent runtime a command should speak for (agent names, model slugs).
 * Explicit flag wins; otherwise the only installed adapter; Claude when both
 * or neither are installed (back-compat with 0.9 output).
 */
export async function resolveTargetAgent(root: string, explicit?: string): Promise<AgentId> {
  if (explicit !== undefined) {
    const value = explicit.toLowerCase();
    if (value === 'codex' || value === 'claude') return value;
    throw new Error(`Unknown agent: ${explicit}. Allowed values: codex, claude`);
  }
  const env = process.env.AGENT_FLOW_AGENT?.toLowerCase();
  if (env === 'codex' || env === 'claude') return env;
  const installed = await readInstalledAdapters(root);
  return installed.length === 1 && installed[0] === 'codex' ? 'codex' : 'claude';
}

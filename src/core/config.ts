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

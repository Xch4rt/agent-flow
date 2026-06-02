import { codexAdapter } from './codex/install-codex.js';
import { claudeAdapter } from './claude/install-claude.js';
import type { AgentAdapter, AgentId } from './types.js';

export type { AgentId, AgentAdapter } from './types.js';

const adapters: Record<AgentId, AgentAdapter> = {
  codex: codexAdapter,
  claude: claudeAdapter,
};

export function getAdapter(id: AgentId): AgentAdapter {
  return adapters[id];
}

export function getAllAdapters(): AgentAdapter[] {
  return Object.values(adapters);
}

export function getAdapterIds(): AgentId[] {
  return Object.keys(adapters) as AgentId[];
}

export function isValidAgentId(value: string): value is AgentId {
  return value in adapters;
}

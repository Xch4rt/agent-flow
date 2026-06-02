import type { ProjectDetection } from '../core/detect-project.js';
import type { WriteResult } from '../core/write-file-safe.js';

export type AgentId = 'codex' | 'claude';

export type AgentAdapter = {
  id: AgentId;
  label: string;
  install(root: string, detection: ProjectDetection, options?: { force?: boolean }): Promise<WriteResult[]>;
  expectedFiles(root: string): string[];
};

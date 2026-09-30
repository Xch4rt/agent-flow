import path from 'node:path';
import fs from 'fs-extra';

const baselineFiles = [
  '.planning/PROJECT.md',
  '.planning/REQUIREMENTS.md',
  '.planning/ROADMAP.md',
  '.planning/STATE.md',
  '.planning/DECISIONS.md',
  '.planning/OPEN_QUESTIONS.md',
  '.memory/events.jsonl',
  '.memory/decisions.jsonl',
  '.memory/errors.jsonl',
  '.memory/modules.jsonl',
];

export type TokenStats = {
  /** How the numbers were produced. Estimates are not observed usage — see `agent-flow usage`. */
  method: 'estimate:chars/4';
  baselineTokens: number;
  packTokens: number;
  /** Signed: negative when the pack is larger than the baseline (a regression). */
  savedTokens: number;
  /** Signed percentage; negative means expansion. */
  reductionPercent: number;
};

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

async function readBaselineText(root: string): Promise<string> {
  const parts: string[] = [];
  for (const file of baselineFiles) {
    const filePath = path.join(root, file);
    if (await fs.pathExists(filePath)) {
      const content = await fs.readFile(filePath, 'utf8');
      if (content.trim()) parts.push(content);
    }
  }
  return parts.join('\n');
}

export async function buildTokenStats(root: string, packText: string): Promise<TokenStats | null> {
  const baselineText = await readBaselineText(root);
  if (!baselineText.trim()) return null;

  const baselineTokens = estimateTokens(baselineText);
  const packTokens = estimateTokens(packText);
  const savedTokens = baselineTokens - packTokens;
  const reductionPercent = baselineTokens > 0 ? Math.round((savedTokens / baselineTokens) * 100) : 0;

  return { method: 'estimate:chars/4', baselineTokens, packTokens, savedTokens, reductionPercent };
}

export function formatTokenStats(stats: Omit<TokenStats, 'method'> & { method?: TokenStats['method'] }): string {
  const expanded = stats.savedTokens < 0;
  return [
    '',
    'Context Stats:',
    '- Method: estimate (chars/4) vs. reading every planning + memory file; not observed usage (see `agent-flow usage`)',
    `- Estimated baseline tokens: ${stats.baselineTokens}`,
    `- Estimated context pack tokens: ${stats.packTokens}`,
    expanded
      ? `- Estimated EXPANSION: ${-stats.savedTokens} tokens (pack is larger than the baseline)`
      : `- Estimated saved tokens: ${stats.savedTokens}`,
    `- Estimated reduction: ${stats.reductionPercent}%`,
  ].join('\n');
}

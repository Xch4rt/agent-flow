import path from 'node:path';
import os from 'node:os';
import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { estimateTokens, buildTokenStats, formatTokenStats } from '../src/core/token-stats.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-flow-stats-test-'));
});

afterEach(async () => {
  await fs.remove(tmpDir);
});

describe('estimateTokens', () => {
  it('returns ceil(length / 4)', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokens('a')).toBe(1);
  });
});

describe('buildTokenStats', () => {
  it('returns null when baseline is empty', async () => {
    const result = await buildTokenStats(tmpDir, 'some pack text');
    expect(result).toBeNull();
  });

  it('computes stats when baseline files exist', async () => {
    await fs.ensureDir(path.join(tmpDir, '.planning'));
    await fs.writeFile(path.join(tmpDir, '.planning/PROJECT.md'), 'A'.repeat(400));
    await fs.writeFile(path.join(tmpDir, '.planning/STATE.md'), 'B'.repeat(400));

    const packText = 'C'.repeat(100);
    const result = await buildTokenStats(tmpDir, packText);

    expect(result).not.toBeNull();
    expect(result!.baselineTokens).toBe(201);
    expect(result!.packTokens).toBe(25);
    expect(result!.savedTokens).toBe(176);
    expect(result!.reductionPercent).toBeGreaterThan(0);
  });

  it('handles memory files in baseline', async () => {
    await fs.ensureDir(path.join(tmpDir, '.memory'));
    await fs.writeFile(path.join(tmpDir, '.memory/events.jsonl'), '{"type":"change","summary":"test"}\n');

    const result = await buildTokenStats(tmpDir, 'short pack');
    expect(result).not.toBeNull();
    expect(result!.baselineTokens).toBeGreaterThan(0);
  });
});

describe('formatTokenStats', () => {
  it('produces readable output', () => {
    const output = formatTokenStats({
      baselineTokens: 8420,
      packTokens: 1375,
      savedTokens: 7045,
      reductionPercent: 84,
    });

    expect(output).toContain('Context Stats:');
    expect(output).toContain('Estimated baseline tokens: 8420');
    expect(output).toContain('Estimated context pack tokens: 1375');
    expect(output).toContain('Estimated saved tokens: 7045');
    expect(output).toContain('Estimated reduction: 84%');
  });
});

import path from 'node:path';
import fs from 'fs-extra';
import pc from 'picocolors';
import { buildContextPack, formatContextPack } from '../core/context-pack.js';
import { getOnboardingState } from '../core/onboard.js';
import { brandTitle } from '../core/terminal-ui.js';
import { buildTokenStats, formatTokenStats } from '../core/token-stats.js';

function parsePositiveInteger(value: string | number | undefined, optionName: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${optionName} must be a positive integer.`);
  }
  return parsed;
}

export type StartOptions = {
  cwd?: string;
  module?: string;
  limit?: string | number;
  budgetLines?: string | number;
  json?: boolean;
  stats?: boolean;
};

async function checkSetupState(cwd: string): Promise<string[]> {
  const warnings: string[] = [];
  const configPath = path.join(cwd, '.agent-flow', 'config.json');
  const initialized = await fs.pathExists(configPath);

  if (!initialized) {
    warnings.push('This repo is not initialized. Run: agent-flow init --codex && agent-flow onboard');
  } else {
    const onboarding = await getOnboardingState(cwd);
    if (!onboarding.onboarded) {
      warnings.push('This repo is not onboarded. Run: agent-flow onboard');
    }
  }
  return warnings;
}

export async function runStart(
  task: string,
  options: StartOptions = {},
): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const setupWarnings = await checkSetupState(cwd);

  const pack = await buildContextPack(task, {
    cwd,
    module: options.module,
    limit: parsePositiveInteger(options.limit, '--limit') ?? 5,
    budgetLines: parsePositiveInteger(options.budgetLines, '--budget-lines') ?? 100,
  });

  if (options.json) {
    const output: Record<string, unknown> = { ...pack };
    output.warnings = [...setupWarnings, ...pack.warnings];
    if (options.stats) {
      const formatted = formatContextPack(pack, {
        budgetLines: parsePositiveInteger(options.budgetLines, '--budget-lines') ?? 100,
      });
      const stats = await buildTokenStats(cwd, formatted);
      if (stats) output.stats = stats;
    }
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  for (const warning of setupWarnings) {
    console.log(pc.yellow(warning));
  }

  console.log(brandTitle('Agent Flow Start'));
  console.log('');
  console.log(`${pc.bold('Task:')} ${task}`);
  console.log('');

  const formatted = formatContextPack(pack, {
    budgetLines: parsePositiveInteger(options.budgetLines, '--budget-lines') ?? 100,
  });
  console.log(formatted.trimEnd());

  console.log('');
  console.log(pc.bold('Paste this into Codex, then run:'));
  console.log(`  ${pc.cyan('$flow-quick')}   for small scoped changes`);
  console.log(`  ${pc.cyan('$flow-plan')}    for larger changes`);
  console.log(`  ${pc.cyan('$flow-verify')}  before committing`);
  console.log(`  ${pc.dim('agent-flow close')}  when done`);

  if (options.stats) {
    const stats = await buildTokenStats(cwd, formatted);
    if (stats) {
      console.log(formatTokenStats(stats));
    } else {
      console.log('\nNot enough baseline context to estimate savings.');
    }
  }
}

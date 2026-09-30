import { budgetContextPack, buildContextPack, formatContextPack } from '../core/context-pack.js';
import { buildTokenStats, formatTokenStats } from '../core/token-stats.js';

function parsePositiveInteger(value: string | number | undefined, optionName: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${optionName} must be a positive integer.`);
  }
  return parsed;
}

export async function runContext(
  task: string,
  options: {
    cwd?: string;
    module?: string;
    limit?: string | number;
    budgetLines?: string | number;
    json?: boolean;
    stats?: boolean;
    includeEvents?: boolean;
    includeOpenQuestions?: boolean;
    noColor?: boolean;
  } = {},
): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const budgetLines = parsePositiveInteger(options.budgetLines, '--budget-lines') ?? 100;
  const pack = await buildContextPack(task, {
    cwd,
    module: options.module,
    limit: parsePositiveInteger(options.limit, '--limit') ?? 5,
    budgetLines,
    includeEvents: options.includeEvents,
    includeOpenQuestions: options.includeOpenQuestions,
  });

  if (options.json) {
    // Emit the same budgeted selection as the text view, and measure exactly what is emitted.
    const budgeted = budgetContextPack(pack, budgetLines);
    const payload = JSON.stringify(budgeted, null, 2);
    if (!options.stats) {
      console.log(payload);
      return;
    }
    const stats = await buildTokenStats(cwd, payload);
    console.log(JSON.stringify(stats ? { ...budgeted, stats } : budgeted, null, 2));
    return;
  }

  const formatted = formatContextPack(pack, { budgetLines });
  console.log(formatted.trimEnd());

  if (options.stats) {
    const stats = await buildTokenStats(cwd, formatted);
    if (stats) {
      console.log(formatTokenStats(stats));
    } else {
      console.log('\nNot enough baseline context to estimate savings.');
    }
  }
}

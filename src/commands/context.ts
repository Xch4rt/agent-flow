import { buildContextPack, formatContextPack } from '../core/context-pack.js';

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
    includeEvents?: boolean;
    includeOpenQuestions?: boolean;
    noColor?: boolean;
  } = {},
): Promise<void> {
  const pack = await buildContextPack(task, {
    cwd: options.cwd,
    module: options.module,
    limit: parsePositiveInteger(options.limit, '--limit') ?? 5,
    budgetLines: parsePositiveInteger(options.budgetLines, '--budget-lines') ?? 100,
    includeEvents: options.includeEvents,
    includeOpenQuestions: options.includeOpenQuestions,
  });

  if (options.json) {
    console.log(JSON.stringify(pack, null, 2));
    return;
  }

  console.log(formatContextPack(pack, {
    budgetLines: parsePositiveInteger(options.budgetLines, '--budget-lines') ?? 100,
  }).trimEnd());
}

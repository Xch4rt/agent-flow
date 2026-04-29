import { z } from 'zod';
import type { MemoryFileName } from './jsonl-memory.js';

export type MemorySchemaError = {
  path: string;
  message: string;
  suggestion?: string;
};

const nonEmptyString = z.string().trim().min(1);
const optionalStringArray = z.array(nonEmptyString).optional();

const baseMemoryEntrySchema = z.object({
  createdAt: nonEmptyString,
  type: nonEmptyString,
  summary: nonEmptyString,
});

export const eventMemorySchema = baseMemoryEntrySchema.extend({
  module: nonEmptyString.optional(),
  files: optionalStringArray,
  tags: optionalStringArray,
});

export const moduleMemorySchema = baseMemoryEntrySchema.extend({
  module: nonEmptyString,
  files: optionalStringArray,
  tags: optionalStringArray,
});

export const decisionMemorySchema = baseMemoryEntrySchema.extend({
  module: nonEmptyString.optional(),
  status: nonEmptyString.optional(),
  rationale: nonEmptyString.optional(),
  alternatives: optionalStringArray,
});

export const errorMemorySchema = baseMemoryEntrySchema.extend({
  module: nonEmptyString.optional(),
  cause: nonEmptyString.optional(),
  solution: nonEmptyString.optional(),
});

export const memorySchemas = {
  events: eventMemorySchema,
  modules: moduleMemorySchema,
  decisions: decisionMemorySchema,
  errors: errorMemorySchema,
} satisfies Record<MemoryFileName, z.ZodTypeAny>;

function suggestionFor(file: MemoryFileName, path: string): string | undefined {
  if (path === 'createdAt') return 'Add createdAt as an ISO timestamp string, or re-add the entry with agent-flow memory append.';
  if (path === 'type') return 'Add a short non-empty type, for example change, decision, error, module, or onboard.';
  if (path === 'summary') return 'Add a short durable summary string.';
  if (file === 'modules' && path === 'module') return 'Add module with the module or area name, or re-add using --module.';
  if (path === 'files') return 'Use an array of file paths, or pass comma-separated paths with --files.';
  if (path === 'tags') return 'Use an array of tags, or pass comma-separated tags with --tags.';
  if (path === 'alternatives') return 'Use an array of alternatives, or pass comma-separated alternatives with --alternatives.';
  return undefined;
}

export function validateMemoryValue(file: MemoryFileName, value: unknown): { ok: true } | { ok: false; errors: MemorySchemaError[] } {
  const result = memorySchemas[file].safeParse(value);

  if (result.success) {
    return { ok: true };
  }

  return {
    ok: false,
    errors: result.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'entry';
      return {
        path,
        message: issue.message,
        suggestion: suggestionFor(file, path),
      };
    }),
  };
}

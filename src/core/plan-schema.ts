import { z } from 'zod';

/**
 * Structured, machine-readable plan that turns ROADMAP/REQUIREMENTS into an
 * orchestration state machine. Lives at `.agent-flow/plan.json`, is committed,
 * and is the canonical source of truth for orchestration state. ROADMAP.md
 * remains a human-readable view.
 */

const idString = z.string().trim().min(1);

/** Requirement id like SHORT-01, ANALYTICS-04. */
export const requirementId = z
  .string()
  .trim()
  .regex(/^[A-Z][A-Z0-9]*-\d+$/, 'requirement id must look like SHORT-01');

export const workStatusSchema = z.enum(['pending', 'active', 'blocked', 'done']);
export type WorkStatus = z.infer<typeof workStatusSchema>;

export const acceptanceSchema = z.object({
  id: idString,
  text: z.string().trim().min(1),
  /** Gate name (e.g. "test") that proves it, or "manual". */
  proof: z.string().trim().min(1).optional(),
});
export type Acceptance = z.infer<typeof acceptanceSchema>;

export const taskSchema = z.object({
  id: idString,
  title: z.string().trim().min(1),
  /** Files/paths the context pack should focus on for this task. */
  scope: z.array(z.string().trim().min(1)).default([]),
  wave: z.number().int().positive().default(1),
  dependsOn: z.array(idString).default([]),
  status: workStatusSchema.default('pending'),
  /** Named gates (resolved to shell commands from config/detection). */
  gates: z.array(z.string().trim().min(1)).default([]),
  acceptance: z.array(acceptanceSchema).default([]),
  /** Waived hardening criteria ("pack/criterion") or whole packs ("pack"). */
  waives: z.array(z.string().trim().min(1)).default([]),
});
export type Task = z.infer<typeof taskSchema>;

export const phaseSchema = z.object({
  id: idString,
  title: z.string().trim().min(1),
  goal: z.string().trim().default(''),
  requirements: z.array(requirementId).default([]),
  dependsOn: z.array(idString).default([]),
  status: workStatusSchema.default('pending'),
  tasks: z.array(taskSchema).default([]),
});
export type Phase = z.infer<typeof phaseSchema>;

export const cursorSchema = z.object({
  phase: idString.nullable().default(null),
  task: idString.nullable().default(null),
});
export type Cursor = z.infer<typeof cursorSchema>;

export const planSchema = z.object({
  schemaVersion: z.literal(1),
  milestone: z.string().trim().min(1).default('v1'),
  createdAt: z.string().trim().min(1),
  updatedAt: z.string().trim().min(1).optional(),
  cursor: cursorSchema.default({ phase: null, task: null }),
  phases: z.array(phaseSchema).default([]),
});
export type Plan = z.infer<typeof planSchema>;

export type PlanParseError = { path: string; message: string };

export function parsePlan(
  value: unknown,
): { ok: true; plan: Plan } | { ok: false; errors: PlanParseError[] } {
  const result = planSchema.safeParse(value);
  if (result.success) return { ok: true, plan: result.data };
  return {
    ok: false,
    errors: result.error.issues.map((issue) => ({
      path: issue.path.length > 0 ? issue.path.join('.') : 'plan',
      message: issue.message,
    })),
  };
}

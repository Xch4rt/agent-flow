import path from 'node:path';
import fs from 'fs-extra';
import { readConfig } from './config.js';
import { getModelRouting } from './models.js';

/**
 * Session guard for Claude Code hooks.
 *
 * Reads the real usage Claude Code recorded in the session transcript and
 * warns (or, opt-in, blocks) before the two patterns that dominate token
 * spend: a session whose context keeps growing, and returning to a big
 * session after its prompt cache expired. Inside executor subagents it can
 * deny further tool calls once the agent's context passes its budget, so the
 * agent writes a handoff instead of growing.
 *
 * A guard must never break a session: every failure path is "allow, silently".
 */

export type HookInput = {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  hook_event_name?: string;
  prompt?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  agent_id?: string;
  agent_type?: string;
};

export type GuardConfig = {
  enabled: boolean;
  /** Main-session context (tokens) past which the guard suggests a handoff + /clear. */
  sessionBudgetTokens: number;
  /** Executor context budget (from orchestration.contextBudgetTokens). */
  executorBudgetTokens: number;
  /** Idle minutes after which the prompt cache is assumed expired. */
  idleMinutes: number;
  /** Only warn about cold resumes for sessions at least this big. */
  minContextTokens: number;
  /** Block the first prompt of a cold resume (re-send to continue). */
  blockColdResume: boolean;
  /** Deny executor tool calls past the executor budget (except writing the handoff). */
  enforceExecutors: boolean;
};

export const DEFAULT_GUARD: Omit<GuardConfig, 'executorBudgetTokens'> = {
  enabled: true,
  sessionBudgetTokens: 200_000,
  idleMinutes: 5,
  minContextTokens: 100_000,
  blockColdResume: false,
  enforceExecutors: true,
};

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

export async function getGuardConfig(root: string): Promise<GuardConfig> {
  const config = await readConfig(root);
  const g = (config?.guard ?? {}) as Record<string, unknown>;
  const routing = await getModelRouting(root);
  return {
    enabled: g.enabled !== false,
    sessionBudgetTokens: num(g.sessionBudgetTokens, DEFAULT_GUARD.sessionBudgetTokens),
    executorBudgetTokens: routing.contextBudgetTokens,
    idleMinutes: num(g.idleMinutes, DEFAULT_GUARD.idleMinutes),
    minContextTokens: num(g.minContextTokens, DEFAULT_GUARD.minContextTokens),
    blockColdResume: g.blockColdResume === true,
    enforceExecutors: g.enforceExecutors !== false,
  };
}

export type LastUsage = { context: number; at?: string };

/** Last API usage recorded in a transcript, reading only its tail (transcripts can be huge). */
export async function lastUsage(file: string, tailBytes = 512 * 1024): Promise<LastUsage | null> {
  let handle: fs.promises.FileHandle | undefined;
  try {
    const stat = await fs.stat(file);
    const start = Math.max(0, stat.size - tailBytes);
    handle = await fs.promises.open(file, 'r');
    const buffer = Buffer.alloc(stat.size - start);
    await handle.read(buffer, 0, buffer.length, start);
    const lines = buffer.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const line = lines[i].trim();
      if (!line.startsWith('{')) continue;
      let row: Record<string, unknown>;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      const message = row.message as Record<string, unknown> | undefined;
      if (row.type !== 'assistant' || !message || message.model === '<synthetic>') continue;
      const u = message.usage as Record<string, unknown> | undefined;
      if (!u) continue;
      const context = num(u.input_tokens, 0) + num(u.cache_creation_input_tokens, 0) + num(u.cache_read_input_tokens, 0);
      return { context, at: typeof row.timestamp === 'string' ? row.timestamp : undefined };
    }
    return null;
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/** Resolve the transcript this hook call belongs to, and whether it is a subagent's. */
export async function resolveTranscript(input: HookInput): Promise<{ file: string; subagent: boolean } | null> {
  const main = input.transcript_path;
  if (!main) return null;
  if (/[\\/]subagents[\\/]agent-[^\\/]+\.jsonl$/.test(main)) return { file: main, subagent: true };
  if (input.agent_id && input.session_id) {
    const candidate = path.join(path.dirname(main), input.session_id, 'subagents', `agent-${input.agent_id}.jsonl`);
    if (await fs.pathExists(candidate)) return { file: candidate, subagent: true };
  }
  return { file: main, subagent: false };
}

function k(tokens: number): string {
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens);
}

export type PromptVerdict = { message?: string; block?: boolean };

const STATE_RELATIVE = path.join('.agent-flow', 'guard-state.json');

async function recentlyBlocked(root: string, sessionId: string, now: number): Promise<boolean> {
  try {
    const state = await fs.readJson(path.join(root, STATE_RELATIVE));
    return state?.sessionId === sessionId && typeof state.blockedAt === 'number' && now - state.blockedAt < 10 * 60_000;
  } catch {
    return false;
  }
}

async function rememberBlock(root: string, sessionId: string, now: number): Promise<void> {
  try {
    await fs.ensureDir(path.join(root, '.agent-flow'));
    await fs.writeJson(path.join(root, STATE_RELATIVE), { sessionId, blockedAt: now });
  } catch {
    // best-effort
  }
}

export async function guardPrompt(input: HookInput, cfg: GuardConfig, root: string, now = Date.now()): Promise<PromptVerdict> {
  if (!cfg.enabled) return {};
  const transcript = await resolveTranscript(input);
  if (!transcript || transcript.subagent) return {};
  const last = await lastUsage(transcript.file);
  if (!last || last.context === 0) return {};

  const idleMinutes = last.at ? (now - Date.parse(last.at)) / 60_000 : 0;
  const cold = idleMinutes >= cfg.idleMinutes && last.context >= cfg.minContextTokens;

  if (cold) {
    const rewrite = Math.round(last.context * 1.25);
    const message = `agent-flow guard: ${Math.round(idleMinutes)} min since the last reply — the prompt cache has likely expired, so this turn re-writes ~${k(last.context)} tokens of context (≈${k(rewrite)} input-eq). Starting something new? Ask for a short handoff and /clear instead.`;
    if (cfg.blockColdResume && input.session_id && !(await recentlyBlocked(root, input.session_id, now))) {
      await rememberBlock(root, input.session_id, now);
      return { message: `${message} Re-send your prompt to continue anyway.`, block: true };
    }
    return { message };
  }

  if (last.context >= cfg.sessionBudgetTokens) {
    return {
      message: `agent-flow guard: every turn of this session re-reads ~${k(last.context)} tokens (budget ${k(cfg.sessionBudgetTokens)}). Consider a short handoff, then /clear and continue from it.`,
    };
  }
  return {};
}

export type ToolVerdict = { deny?: string };

function isHandoffWrite(input: HookInput): boolean {
  const target = input.tool_input?.file_path ?? input.tool_input?.path;
  return typeof target === 'string' && /[\\/]?\.agent-flow[\\/]handoffs[\\/]/.test(target);
}

export async function guardTool(input: HookInput, cfg: GuardConfig): Promise<ToolVerdict> {
  if (!cfg.enabled || !cfg.enforceExecutors) return {};
  const transcript = await resolveTranscript(input);
  // Only enforce when we positively identified the executor's own transcript.
  if (!transcript?.subagent) return {};
  if (isHandoffWrite(input)) return {};
  const last = await lastUsage(transcript.file);
  if (!last || last.context < cfg.executorBudgetTokens) return {};
  return {
    deny: `agent-flow guard: your context is ~${k(last.context)} tokens, past the executor budget (${k(cfg.executorBudgetTokens)}). Stop here: write .agent-flow/handoffs/<task-id>.md (done, failing, next step, files — under 40 lines) and return "status: handoff".`,
  };
}

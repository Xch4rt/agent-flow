import path from 'node:path';
import {
  CODEX_EQUIVALENT_WEIGHTS,
  buildUsageReport,
  type ParsedCall,
  type ParsedTranscript,
  type UsageOptions,
  type UsageReport,
} from './claude-usage.js';
import { codexHome, listRolloutFiles, readRolloutText, readSessionMeta, threadIdFromFile } from './codex-sessions.js';

/**
 * Observed token usage from Codex session rollouts
 * (`$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl`).
 *
 * Each API response is recorded as a `token_usage_record` line (older rollouts
 * only have `event_msg` / `token_count` events — used as a fallback). OpenAI's
 * `input_tokens` includes the cached part, so the four kinds map as:
 *
 *   input      = input_tokens − cached_input_tokens   (uncached, billed 1x)
 *   cacheRead  = cached_input_tokens                  (billed 0.1x)
 *   cacheWrite = cache_write_input_tokens             (usually 0 — OpenAI does not charge for writes)
 *   output     = output_tokens                        (includes reasoning)
 *
 * Spawned subagents are separate threads with their own rollout; their
 * `session_meta.parent_thread_id` links them to the root session and
 * `agent_role` names the custom agent (e.g. `flow_executor`).
 */

type RawUsage = {
  input_tokens?: number;
  cached_input_tokens?: number;
  cache_write_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
};

const SPAWN_TOOLS = new Set(['spawn_agent']);
const CONTINUATION_TOOLS = new Set(['followup_task', 'send_input', 'send_message', 'resume_agent']);
const SKILL_MENTION = /(?:^|\s)\$([a-z0-9][a-z0-9_-]*)/i;

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function usageOf(raw: RawUsage): ParsedCall['usage'] {
  const input = num(raw.input_tokens);
  const cached = Math.min(num(raw.cached_input_tokens), input);
  return {
    calls: 1,
    input: input - cached,
    cacheWrite: num(raw.cache_write_input_tokens),
    cacheRead: cached,
    output: num(raw.output_tokens),
  };
}

/** Text a person typed in a user message (environment and tool context blocks are skipped). */
function userText(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  const texts = content
    .filter((c): c is Record<string, unknown> => isRecord(c) && c.type === 'input_text' && typeof c.text === 'string')
    .map((c) => String(c.text).trim())
    .filter((t) => t && !t.startsWith('<'));
  return texts.length ? texts.join('\n') : null;
}

export async function parseCodexRollout(file: string, since?: Date): Promise<ParsedTranscript> {
  const text = await readRolloutText(file);
  const fileThread = threadIdFromFile(file);
  const agentTypes: Record<string, string> = {};
  const continuations: Record<string, number> = {};
  const empty: ParsedTranscript = { calls: [], agentTypes, continuations, spawns: 0 };
  if (text === null) return empty;

  const cutoff = since?.getTime();
  let cwd: string | undefined;
  let rootSession: string | undefined;
  let threadId = fileThread;
  let sidechain = false;
  let agentRole: string | undefined;
  const modelByTurn = new Map<string, string>();
  let lastModel = 'unknown';
  let activeSkill = '(no skill)';
  let spawns = 0;

  const records = new Map<string, ParsedCall>();
  const counts: ParsedCall[] = [];
  // spawn_agent call id → task_name, and task_name → spawned thread id (from the call output), so
  // followup_task/send_message continuations (addressed by task name) attribute to the right agent.
  const spawnTasks = new Map<string, string>();
  const threadByTask = new Map<string, string>();
  let ordinal = 0;

  for (const line of text.split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    let row: Record<string, unknown>;
    try {
      const parsed = JSON.parse(line);
      if (!isRecord(parsed)) continue;
      row = parsed;
    } catch {
      continue;
    }
    ordinal += 1;
    const type = row.type;
    const payload = isRecord(row.payload) ? row.payload : {};
    const at = str(row.timestamp) ?? '';

    if (type === 'session_meta') {
      cwd = str(payload.cwd) ?? cwd;
      threadId = str(payload.id) ?? threadId;
      rootSession = str(payload.session_id) ?? rootSession;
      const parent = str(payload.parent_thread_id);
      if (parent) {
        sidechain = true;
        agentRole = str(payload.agent_role) ?? str(payload.agent_nickname) ?? 'subagent';
        if (threadId) agentTypes[threadId] = agentRole;
        if (!rootSession || rootSession === threadId) rootSession = parent;
      }
      continue;
    }

    if (type === 'turn_context') {
      if (!cwd) cwd = str(payload.cwd);
      const model = str(payload.model);
      if (model) {
        lastModel = model;
        const turn = str(payload.turn_id);
        if (turn) modelByTurn.set(turn, model);
      }
      continue;
    }

    if (type === 'response_item') {
      const itemType = payload.type;
      if (itemType === 'message' && payload.role === 'user' && !sidechain) {
        const prompt = userText(payload.content);
        if (prompt) {
          const mention = SKILL_MENTION.exec(prompt);
          activeSkill = mention ? mention[1] : '(no skill)';
        }
      } else if (itemType === 'function_call') {
        const name = str(payload.name) ?? '';
        let args: Record<string, unknown> = {};
        try {
          const parsedArgs = JSON.parse(String(payload.arguments ?? '{}'));
          if (isRecord(parsedArgs)) args = parsedArgs;
        } catch {
          // unparseable arguments: ignore
        }
        if (SPAWN_TOOLS.has(name)) {
          spawns += 1;
          const callId = str(payload.call_id);
          const taskName = str(args.task_name);
          if (callId && taskName) spawnTasks.set(callId, taskName);
        } else if (CONTINUATION_TOOLS.has(name)) {
          const target = str(args.target) ?? str(args.id) ?? '?';
          const key = threadByTask.get(target) ?? target;
          continuations[key] = (continuations[key] ?? 0) + 1;
        }
      } else if (itemType === 'function_call_output') {
        const taskName = spawnTasks.get(str(payload.call_id) ?? '');
        if (taskName) {
          const spawned = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(String(payload.output ?? ''))?.[0];
          if (spawned) threadByTask.set(taskName, spawned);
        }
      }
      continue;
    }

    const session = rootSession ?? threadId ?? path.basename(file);
    const thread = sidechain ? `side:${threadId ?? file}` : 'main';
    const base = {
      sessionId: session,
      at,
      sidechain,
      agentId: sidechain ? threadId : undefined,
      thread,
      skill: sidechain ? '(subagent)' : activeSkill,
    };

    if (type === 'token_usage_record' && isRecord(payload.usage)) {
      if (cutoff !== undefined && at && Date.parse(at) < cutoff) continue;
      const turn = str(payload.turn_id);
      const key = str(payload.response_id) ?? `${file}:${ordinal}`;
      const call: ParsedCall = { key, model: (turn && modelByTurn.get(turn)) ?? lastModel, usage: usageOf(payload.usage as RawUsage), ...base };
      // A response can be recorded more than once (checkpoints); keep the first, largest output wins.
      const previous = records.get(key);
      if (previous) previous.usage.output = Math.max(previous.usage.output, call.usage.output);
      else records.set(key, call);
      continue;
    }

    if (type === 'event_msg' && payload.type === 'token_count' && isRecord(payload.info) && isRecord(payload.info.last_token_usage)) {
      if (cutoff !== undefined && at && Date.parse(at) < cutoff) continue;
      counts.push({
        key: `${file}:${ordinal}`,
        model: lastModel,
        usage: usageOf(payload.info.last_token_usage as RawUsage),
        ...base,
      });
    }
  }

  // `token_usage_record` is authoritative when present; `token_count` events
  // (older CLIs) can repeat the same response, so they are only a fallback.
  const calls = records.size > 0 ? [...records.values()] : counts;
  return { calls, cwd, sessionId: rootSession ?? threadId, agentTypes, continuations, spawns };
}

function sameProject(cwd: string | undefined, project: string): boolean {
  if (!cwd) return false;
  const a = path.resolve(cwd);
  const b = path.resolve(project);
  return a === b || a.startsWith(`${b}${path.sep}`);
}

export async function findCodexRolloutFiles(options: { projectPath?: string; all?: boolean; dir?: string; since?: Date }): Promise<{ source: string; files: string[]; skippedCompressed: number }> {
  const dir = options.dir ?? codexHome();
  const all = await listRolloutFiles(dir, { since: options.since });
  let skippedCompressed = 0;
  const files: string[] = [];
  const project = options.projectPath ?? process.cwd();
  for (const file of all) {
    const meta = await readSessionMeta(file);
    if (meta === null) {
      if (file.endsWith('.zst')) skippedCompressed += 1;
      continue;
    }
    if (options.all || sameProject(str(meta.cwd), project)) files.push(file);
  }
  return { source: path.join(dir, 'sessions'), files, skippedCompressed };
}

export async function buildCodexUsageReport(files: string[], source: string, options: UsageOptions = {}): Promise<UsageReport> {
  return buildUsageReport(files, source, { ...options, agent: 'codex', coldField: 'input', weights: CODEX_EQUIVALENT_WEIGHTS }, parseCodexRollout);
}

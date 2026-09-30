import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import fs from 'fs-extra';

/**
 * Observed token usage from Claude Code session transcripts
 * (`~/.claude/projects/<project-slug>/*.jsonl`).
 *
 * These numbers are what the API reported per request — not an estimate.
 * They cover the whole session: history, tool output, file reads, subagents.
 */

export type UsageTotals = {
  calls: number;
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
};

export type CacheBreak = {
  sessionId: string;
  at: string;
  sidechain: boolean;
  cacheWrite: number;
  /** Minutes since the previous request in the same thread; null for the first request. */
  gapMinutes: number | null;
  reason: 'idle' | 'prefix-change' | 'first-request';
};

export type SessionUsage = {
  sessionId: string;
  file: string;
  cwd?: string;
  start?: string;
  end?: string;
  totals: UsageTotals;
  main: UsageTotals;
  subagents: UsageTotals;
  /** Largest single-request context (input + cache write + cache read). */
  peakContext: number;
  cacheBreaks: CacheBreak[];
  bySkill: Record<string, UsageTotals>;
  byModel: Record<string, UsageTotals>;
};

export type SubagentUsage = {
  agentId: string;
  sessionId: string;
  type: string;
  cwd?: string;
  first?: string;
  last?: string;
  totals: UsageTotals;
  /** Largest single-request context this agent carried. */
  peakContext: number;
  /** Cache rewrites after an idle gap inside this agent's own thread. */
  idleRewrites: number;
  idleRewriteTokens: number;
  /** SendMessage calls addressed to this agent (continuations instead of a fresh spawn). */
  continuations: number;
};

export type AgentTypeUsage = {
  agents: number;
  continuations: number;
  totals: UsageTotals;
  peakContext: number;
  idleRewriteTokens: number;
};

export type ProjectUsage = {
  sessions: number;
  totals: UsageTotals;
  main: UsageTotals;
  subagents: UsageTotals;
  peakContext: number;
  idleRewriteTokens: number;
};

export type UsageReport = {
  source: string;
  files: number;
  sessions: SessionUsage[];
  byProject: Record<string, ProjectUsage>;
  byAgentType: Record<string, AgentTypeUsage>;
  agents: SubagentUsage[];
  spawns: number;
  continuations: number;
  totals: UsageTotals;
  main: UsageTotals;
  subagents: UsageTotals;
  byModel: Record<string, UsageTotals>;
  bySkill: Record<string, UsageTotals>;
  cacheBreaks: CacheBreak[];
  weights: typeof INPUT_EQUIVALENT_WEIGHTS;
};

/**
 * Relative weights used to fold the four token kinds into one comparable
 * "input-equivalent" number, following the published API price ratios
 * (cache write 1.25x, cache read 0.1x, output 5x of base input). A ranking
 * aid, not a bill — subscription limits are not published per token kind.
 */
export const INPUT_EQUIVALENT_WEIGHTS = { input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 } as const;

export type UsageOptions = {
  /** Only requests at or after this instant. */
  since?: Date;
  /** Idle gap (minutes) after which a large cache write counts as a cold-cache rewrite. */
  idleMinutes?: number;
  /** Minimum cache-write tokens for a request to count as a cache break. */
  breakThreshold?: number;
};

export function emptyTotals(): UsageTotals {
  return { calls: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
}

export function addTotals(target: UsageTotals, source: UsageTotals): UsageTotals {
  target.calls += source.calls;
  target.input += source.input;
  target.cacheWrite += source.cacheWrite;
  target.cacheRead += source.cacheRead;
  target.output += source.output;
  return target;
}

export function inputEquivalent(t: UsageTotals): number {
  const w = INPUT_EQUIVALENT_WEIGHTS;
  return Math.round(t.input * w.input + t.cacheWrite * w.cacheWrite + t.cacheRead * w.cacheRead + t.output * w.output);
}

export function contextOf(t: Pick<UsageTotals, 'input' | 'cacheWrite' | 'cacheRead'>): number {
  return t.input + t.cacheWrite + t.cacheRead;
}

function bump(map: Record<string, UsageTotals>, key: string, call: UsageTotals): void {
  addTotals((map[key] ??= emptyTotals()), call);
}

// ---------------------------------------------------------------------------
// Locating transcripts
// ---------------------------------------------------------------------------

export function claudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude');
}

/** Claude Code names a project's transcript folder after its path with every non-alphanumeric char replaced by '-'. */
export function projectSlug(projectPath: string): string {
  return path.resolve(projectPath).replace(/[^a-zA-Z0-9]/g, '-');
}

async function listJsonl(dir: string): Promise<string[]> {
  const out: string[] = [];
  if (!(await fs.pathExists(dir))) return out;
  const walk = async (current: string, depth: number): Promise<void> => {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory() && depth < 3) await walk(full, depth + 1);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) out.push(full);
    }
  };
  await walk(dir, 0);
  return out.sort();
}

export async function findTranscriptFiles(options: { projectPath?: string; all?: boolean; dir?: string; since?: Date }): Promise<{ source: string; files: string[] }> {
  const projectsDir = path.join(options.dir ?? claudeConfigDir(), 'projects');
  let source = projectsDir;
  let files: string[];

  if (options.all) {
    files = await listJsonl(projectsDir);
  } else {
    const slugDir = path.join(projectsDir, projectSlug(options.projectPath ?? process.cwd()));
    source = slugDir;
    files = await listJsonl(slugDir);
  }

  if (options.since) {
    const cutoff = options.since.getTime();
    const recent: string[] = [];
    for (const file of files) {
      const stat = await fs.stat(file);
      if (stat.mtimeMs >= cutoff) recent.push(file);
    }
    files = recent;
  }

  return { source, files };
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

type RawUsage = {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
};

type ParsedCall = {
  key: string;
  sessionId: string;
  at: string;
  sidechain: boolean;
  agentId?: string;
  thread: string;
  model: string;
  skill: string;
  usage: UsageTotals;
};

const SPAWN_TOOLS = new Set(['Agent', 'Task']);

type ParsedTranscript = {
  calls: ParsedCall[];
  cwd?: string;
  sessionId?: string;
  /** agentId -> subagent type, learned from the parent's Agent/Task tool_use + its result. */
  agentTypes: Record<string, string>;
  /** SendMessage continuations per target (agent id or name). */
  continuations: Record<string, number>;
  spawns: number;
};

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value) return value;
  }
  return undefined;
}

/** Subagent id encoded in Claude Code's per-agent transcript file name (`agent-<id>.jsonl`). */
export function agentIdFromFile(file: string): string | undefined {
  return /agent-([^\\/]+)\.jsonl$/.exec(file)?.[1];
}

async function readAgentMetaType(file: string): Promise<string | undefined> {
  const metaFile = file.replace(/\.jsonl$/, '.meta.json');
  if (metaFile === file || !(await fs.pathExists(metaFile))) return undefined;
  try {
    const meta = await fs.readJson(metaFile);
    return isRecord(meta) ? firstString(meta, ['agentType', 'subagentType', 'subagent_type', 'type', 'name']) : undefined;
  } catch {
    return undefined;
  }
}

const COMMAND_NAME = /<command-name>\s*\/?([^<\s]+)\s*<\/command-name>/;

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Text of a user turn typed by the person (not a tool result). Returns null for tool results. */
function userPromptText(message: unknown): string | null {
  if (!isRecord(message)) return null;
  const content = message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  if (content.some((block) => isRecord(block) && block.type === 'tool_result')) return null;
  return content
    .filter((block): block is Record<string, unknown> => isRecord(block) && block.type === 'text')
    .map((block) => String(block.text ?? ''))
    .join('\n');
}

function skillInvokedBy(message: unknown): string | null {
  if (!isRecord(message) || !Array.isArray(message.content)) return null;
  for (const block of message.content) {
    if (isRecord(block) && block.type === 'tool_use' && block.name === 'Skill' && isRecord(block.input)) {
      const skill = block.input.skill ?? block.input.command ?? block.input.name;
      if (typeof skill === 'string' && skill) return skill.replace(/^\//, '');
    }
  }
  return null;
}

/**
 * Parse one transcript file into deduplicated API calls.
 *
 * Claude Code writes one line per content block, repeating the same usage
 * for every block of a response, so calls are keyed by requestId/message.id.
 * Subagent turns are marked `isSidechain` (inline, or in a separate file).
 */
export async function parseTranscript(file: string, since?: Date): Promise<ParsedTranscript> {
  const calls = new Map<string, ParsedCall>();
  const activeSkill = new Map<string, string>();
  const spawnTypes = new Map<string, string>();
  const agentTypes: Record<string, string> = {};
  const continuations: Record<string, number> = {};
  let spawns = 0;
  let cwd: string | undefined;
  let fileSessionId: string | undefined;
  const cutoff = since?.getTime();
  const fileAgentId = agentIdFromFile(file);
  const fileIsSubagent = Boolean(fileAgentId) || /(^|[\\/])subagents[\\/]/.test(file);
  if (fileAgentId) {
    const metaType = await readAgentMetaType(file);
    if (metaType) agentTypes[fileAgentId] = metaType;
  }

  const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let row: Record<string, unknown>;
    try {
      const parsed = JSON.parse(line);
      if (!isRecord(parsed)) continue;
      row = parsed;
    } catch {
      continue;
    }

    const sessionId = typeof row.sessionId === 'string' ? row.sessionId : undefined;
    if (sessionId && !fileSessionId) fileSessionId = sessionId;
    if (!cwd && typeof row.cwd === 'string') cwd = row.cwd;
    const sidechain = row.isSidechain === true || fileIsSubagent;
    const agentId = fileAgentId ?? (typeof row.agentId === 'string' ? row.agentId : undefined);
    const thread = sidechain ? `side:${agentId ?? file}` : 'main';

    // Link spawned agents to their type: the tool_result row carries toolUseResult.agentId.
    if (row.type === 'user' && isRecord(row.toolUseResult) && typeof row.toolUseResult.agentId === 'string' && isRecord(row.message) && Array.isArray(row.message.content)) {
      for (const block of row.message.content) {
        if (isRecord(block) && block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
          const type = spawnTypes.get(block.tool_use_id);
          if (type && !agentTypes[row.toolUseResult.agentId]) agentTypes[row.toolUseResult.agentId] = type;
        }
      }
    }

    if (row.type === 'user') {
      const text = userPromptText(row.message);
      if (text !== null && !sidechain) {
        const command = COMMAND_NAME.exec(text);
        activeSkill.set(thread, command ? command[1] : '(no skill)');
      }
      continue;
    }

    if (row.type !== 'assistant' || !isRecord(row.message)) continue;
    const message = row.message;

    const invoked = skillInvokedBy(message);
    if (invoked && !sidechain) activeSkill.set(thread, invoked);

    if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (!isRecord(block) || block.type !== 'tool_use' || !isRecord(block.input)) continue;
        const name = String(block.name ?? '');
        if (SPAWN_TOOLS.has(name)) {
          spawns += 1;
          const type = firstString(block.input, ['subagent_type', 'subagentType', 'agent_type']) ?? 'general-purpose';
          if (typeof block.id === 'string') spawnTypes.set(block.id, type);
        } else if (name === 'SendMessage') {
          const target = firstString(block.input, ['to', 'agentId', 'agent_id', 'target', 'name', 'recipient']) ?? '?';
          continuations[target] = (continuations[target] ?? 0) + 1;
        }
      }
    }

    const usage = message.usage as RawUsage | undefined;
    if (!isRecord(usage)) continue;
    const at = typeof row.timestamp === 'string' ? row.timestamp : '';
    if (cutoff !== undefined && at && Date.parse(at) < cutoff) continue;

    const key = String(row.requestId ?? message.id ?? row.uuid ?? `${file}:${calls.size}`);
    const call: ParsedCall = {
      key,
      sessionId: sessionId ?? fileSessionId ?? path.basename(file, '.jsonl'),
      at,
      sidechain,
      agentId: sidechain ? agentId : undefined,
      thread,
      model: typeof message.model === 'string' ? message.model : 'unknown',
      skill: sidechain ? '(subagent)' : activeSkill.get(thread) ?? '(no skill)',
      usage: {
        calls: 1,
        input: num(usage.input_tokens),
        cacheWrite: num(usage.cache_creation_input_tokens),
        cacheRead: num(usage.cache_read_input_tokens),
        output: num(usage.output_tokens),
      },
    };
    if (call.model === '<synthetic>') continue;

    // Later blocks of the same response carry the final (largest) output count.
    const previous = calls.get(key);
    if (previous) {
      previous.usage.output = Math.max(previous.usage.output, call.usage.output);
      continue;
    }
    calls.set(key, call);
  }

  return { calls: [...calls.values()], cwd, sessionId: fileSessionId, agentTypes, continuations, spawns };
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export function summarizeCalls(calls: ParsedCall[], meta: { file: string; cwd?: string; sessionId: string }, options: UsageOptions = {}): SessionUsage {
  const idleMinutes = options.idleMinutes ?? 5;
  const breakThreshold = options.breakThreshold ?? 20_000;
  const sorted = [...calls].sort((a, b) => a.at.localeCompare(b.at));

  const session: SessionUsage = {
    sessionId: meta.sessionId,
    file: meta.file,
    cwd: meta.cwd,
    start: sorted[0]?.at,
    end: sorted[sorted.length - 1]?.at,
    totals: emptyTotals(),
    main: emptyTotals(),
    subagents: emptyTotals(),
    peakContext: 0,
    cacheBreaks: [],
    bySkill: {},
    byModel: {},
  };

  const lastAt = new Map<string, number>();
  for (const call of sorted) {
    addTotals(session.totals, call.usage);
    addTotals(call.sidechain ? session.subagents : session.main, call.usage);
    bump(session.bySkill, call.skill, call.usage);
    bump(session.byModel, call.model, call.usage);
    session.peakContext = Math.max(session.peakContext, contextOf(call.usage));

    const time = Date.parse(call.at);
    const prev = lastAt.get(call.thread);
    if (call.usage.cacheWrite >= breakThreshold) {
      const gapMinutes = prev !== undefined && !Number.isNaN(time) ? (time - prev) / 60_000 : null;
      session.cacheBreaks.push({
        sessionId: call.sessionId,
        at: call.at,
        sidechain: call.sidechain,
        cacheWrite: call.usage.cacheWrite,
        gapMinutes: gapMinutes === null ? null : Math.round(gapMinutes * 10) / 10,
        reason: gapMinutes === null ? 'first-request' : gapMinutes >= idleMinutes ? 'idle' : 'prefix-change',
      });
    }
    if (!Number.isNaN(time)) lastAt.set(call.thread, time);
  }

  return session;
}

function summarizeAgents(
  calls: ParsedCall[],
  sessionId: string,
  cwd: string | undefined,
  agentTypes: Record<string, string>,
  continuations: Record<string, number>,
  options: UsageOptions,
): SubagentUsage[] {
  const idleMinutes = options.idleMinutes ?? 5;
  const breakThreshold = options.breakThreshold ?? 20_000;
  const byAgent = new Map<string, ParsedCall[]>();
  for (const call of calls) {
    if (!call.sidechain) continue;
    const id = call.agentId ?? '(inline)';
    byAgent.set(id, [...(byAgent.get(id) ?? []), call]);
  }
  const out: SubagentUsage[] = [];
  for (const [agentId, agentCalls] of byAgent) {
    agentCalls.sort((a, b) => a.at.localeCompare(b.at));
    const agent: SubagentUsage = {
      agentId,
      sessionId,
      type: agentTypes[agentId] ?? 'unknown',
      cwd,
      first: agentCalls[0]?.at,
      last: agentCalls[agentCalls.length - 1]?.at,
      totals: emptyTotals(),
      peakContext: 0,
      idleRewrites: 0,
      idleRewriteTokens: 0,
      continuations: 0,
    };
    let prev: number | undefined;
    for (const call of agentCalls) {
      addTotals(agent.totals, call.usage);
      agent.peakContext = Math.max(agent.peakContext, contextOf(call.usage));
      const time = Date.parse(call.at);
      if (prev !== undefined && !Number.isNaN(time) && call.usage.cacheWrite >= breakThreshold && (time - prev) / 60_000 >= idleMinutes) {
        agent.idleRewrites += 1;
        agent.idleRewriteTokens += call.usage.cacheWrite;
      }
      if (!Number.isNaN(time)) prev = time;
    }
    // SendMessage may address an agent by id or by the name it was spawned with; match either.
    agent.continuations = Object.entries(continuations)
      .filter(([target]) => target === agentId || agentId.startsWith(target) || target.startsWith(agentId))
      .reduce((sum, [, n]) => sum + n, 0);
    out.push(agent);
  }
  return out;
}

export async function buildUsageReport(
  files: string[],
  source: string,
  options: UsageOptions = {},
): Promise<UsageReport> {
  // Subagent transcripts may live in their own files; group every call by session id.
  const bySession = new Map<string, { calls: ParsedCall[]; file: string; cwd?: string; continuations: Record<string, number> }>();
  const agentTypes: Record<string, string> = {};
  let spawns = 0;
  for (const file of files) {
    const parsed = await parseTranscript(file, options.since);
    Object.assign(agentTypes, parsed.agentTypes);
    spawns += parsed.spawns;
    const sessionKey = parsed.sessionId ?? parsed.calls[0]?.sessionId;
    if (sessionKey && Object.keys(parsed.continuations).length > 0) {
      const entry = bySession.get(sessionKey) ?? { calls: [], file, cwd: parsed.cwd, continuations: {} };
      for (const [k, v] of Object.entries(parsed.continuations)) entry.continuations[k] = (entry.continuations[k] ?? 0) + v;
      bySession.set(sessionKey, entry);
    }
    for (const call of parsed.calls) {
      const entry = bySession.get(call.sessionId) ?? { calls: [], file, cwd: parsed.cwd, continuations: {} };
      if (!entry.cwd && parsed.cwd) entry.cwd = parsed.cwd;
      // Prefer the main (non-subagent) file as the session's file.
      if (!call.sidechain) entry.file = file;
      entry.calls.push(call);
      bySession.set(call.sessionId, entry);
    }
  }

  const sessions: SessionUsage[] = [];
  const agents: SubagentUsage[] = [];
  let continuations = 0;
  for (const [sessionId, entry] of bySession) {
    if (entry.calls.length === 0) continue;
    // Deduplicate across files (a subagent response can be mirrored in both).
    const unique = [...new Map(entry.calls.map((c) => [c.key, c])).values()];
    for (const call of unique) {
      if (call.sidechain) call.skill = `agent:${(call.agentId && agentTypes[call.agentId]) ?? 'unknown'}`;
    }
    sessions.push(summarizeCalls(unique, { file: entry.file, cwd: entry.cwd, sessionId }, options));
    agents.push(...summarizeAgents(unique, sessionId, entry.cwd, agentTypes, entry.continuations, options));
    continuations += Object.values(entry.continuations).reduce((a, b) => a + b, 0);
  }
  sessions.sort((a, b) => inputEquivalent(b.totals) - inputEquivalent(a.totals));
  agents.sort((a, b) => inputEquivalent(b.totals) - inputEquivalent(a.totals));

  const report: UsageReport = {
    source,
    files: files.length,
    sessions,
    byProject: {},
    byAgentType: {},
    agents,
    spawns,
    continuations,
    totals: emptyTotals(),
    main: emptyTotals(),
    subagents: emptyTotals(),
    byModel: {},
    bySkill: {},
    cacheBreaks: [],
    weights: INPUT_EQUIVALENT_WEIGHTS,
  };
  for (const s of sessions) {
    addTotals(report.totals, s.totals);
    addTotals(report.main, s.main);
    addTotals(report.subagents, s.subagents);
    for (const [k, v] of Object.entries(s.byModel)) addTotals((report.byModel[k] ??= emptyTotals()), v);
    for (const [k, v] of Object.entries(s.bySkill)) addTotals((report.bySkill[k] ??= emptyTotals()), v);
    report.cacheBreaks.push(...s.cacheBreaks);

    const project = (report.byProject[s.cwd ?? '(unknown)'] ??= {
      sessions: 0, totals: emptyTotals(), main: emptyTotals(), subagents: emptyTotals(), peakContext: 0, idleRewriteTokens: 0,
    });
    project.sessions += 1;
    addTotals(project.totals, s.totals);
    addTotals(project.main, s.main);
    addTotals(project.subagents, s.subagents);
    project.peakContext = Math.max(project.peakContext, s.peakContext);
    project.idleRewriteTokens += s.cacheBreaks.filter((b) => b.reason === 'idle').reduce((sum, b) => sum + b.cacheWrite, 0);
  }
  for (const agent of agents) {
    const type = (report.byAgentType[agent.type] ??= { agents: 0, continuations: 0, totals: emptyTotals(), peakContext: 0, idleRewriteTokens: 0 });
    type.agents += 1;
    type.continuations += agent.continuations;
    addTotals(type.totals, agent.totals);
    type.peakContext = Math.max(type.peakContext, agent.peakContext);
    type.idleRewriteTokens += agent.idleRewriteTokens;
  }
  report.cacheBreaks.sort((a, b) => b.cacheWrite - a.cacheWrite);
  return report;
}

/** Parse "7d", "12h", "90m" or an ISO date. */
export function parseSince(value: string | undefined, now = Date.now()): Date | undefined {
  if (!value) return undefined;
  const match = /^(\d+)\s*([dhm])$/i.exec(value.trim());
  if (match) {
    const n = Number(match[1]);
    const unit = match[2].toLowerCase();
    const ms = unit === 'd' ? 86_400_000 : unit === 'h' ? 3_600_000 : 60_000;
    return new Date(now - n * ms);
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new Error(`--since must look like 7d, 12h, 90m or an ISO date (got "${value}")`);
  return new Date(parsed);
}

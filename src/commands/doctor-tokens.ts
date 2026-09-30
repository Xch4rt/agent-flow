import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import fs from 'fs-extra';
import pc from 'picocolors';
import { guardHookInstalled, missingGitignoreEntries } from '../core/claude-settings.js';
import { buildUsageReport, findTranscriptFiles } from '../core/claude-usage.js';
import { TIER_AGENTS } from '../core/models.js';
import { estimateTokens } from '../core/token-stats.js';
import { brandTitle, statusLabel } from '../core/terminal-ui.js';

type Check = { level: 'ok' | 'warning' | 'fail'; label: string; detail?: string };

const ALWAYS_LOADED_BUDGET = 2_500;
const MCP_SERVER_WARN = 5;

function k(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

async function readText(file: string): Promise<string> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return '';
  }
}

/** Instruction files Claude Code loads on every request: CLAUDE.md plus its @imports (one level). */
async function alwaysLoadedTokens(root: string): Promise<{ tokens: number; files: string[] }> {
  const files: string[] = [];
  let text = '';
  for (const name of ['CLAUDE.md', '.claude/CLAUDE.md']) {
    const content = await readText(path.join(root, name));
    if (!content) continue;
    files.push(name);
    text += content;
    for (const match of content.matchAll(/^@(\S+)/gm)) {
      const imported = await readText(path.join(root, match[1]));
      if (imported) {
        files.push(match[1]);
        text += imported;
      }
    }
  }
  return { tokens: estimateTokens(text), files };
}

async function mcpServers(root: string): Promise<string[]> {
  try {
    const config = await fs.readJson(path.join(root, '.mcp.json'));
    return Object.keys(config?.mcpServers ?? {});
  } catch {
    return [];
  }
}

async function userModelSetting(): Promise<string | undefined> {
  try {
    const settings = await fs.readJson(path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude'), 'settings.json'));
    return typeof settings?.model === 'string' ? settings.model : undefined;
  } catch {
    return undefined;
  }
}

async function onPath(command: string): Promise<boolean> {
  const result = await execa('sh', ['-c', `command -v ${command}`], { reject: false });
  return result.exitCode === 0;
}

export async function collectTokenChecks(root: string, options: { claudeDir?: string; since?: Date } = {}): Promise<Check[]> {
  const checks: Check[] = [];

  const loaded = await alwaysLoadedTokens(root);
  checks.push({
    level: loaded.tokens > ALWAYS_LOADED_BUDGET ? 'warning' : 'ok',
    label: `always-loaded instructions ≈${k(loaded.tokens)} tokens`,
    detail: loaded.files.length ? `${loaded.files.join(' + ')} — sent with every request and every subagent${loaded.tokens > ALWAYS_LOADED_BUDGET ? `; keep under ~${k(ALWAYS_LOADED_BUDGET)}` : ''}` : 'no CLAUDE.md',
  });

  const servers = await mcpServers(root);
  checks.push({
    level: servers.length > MCP_SERVER_WARN ? 'warning' : 'ok',
    label: `project MCP servers: ${servers.length}`,
    detail: servers.length > MCP_SERVER_WARN ? `${servers.join(', ')} — disable the ones this project does not need` : undefined,
  });

  const model = await userModelSetting();
  if (model && /1m/i.test(model)) {
    checks.push({ level: 'warning', label: `default model ${model}`, detail: 'the 1M window lets sessions grow to ~1M tokens re-read per turn; prefer 200k and /clear between tasks' });
  }

  checks.push(
    (await guardHookInstalled(root))
      ? { level: 'ok', label: 'session guard hook installed' }
      : { level: 'warning', label: 'session guard hook missing', detail: 'run agent-flow init --claude' },
  );
  checks.push(
    (await onPath('agent-flow'))
      ? { level: 'ok', label: 'agent-flow on PATH (hooks can run)' }
      : { level: 'warning', label: 'agent-flow not on PATH', detail: 'hooks no-op until: npm install -g @xch4rt/agent-flow' },
  );

  const agents = Object.values(TIER_AGENTS);
  const missingAgents: string[] = [];
  for (const name of agents) if (!(await fs.pathExists(path.join(root, '.claude', 'agents', `${name}.md`)))) missingAgents.push(name);
  checks.push(
    missingAgents.length === 0
      ? { level: 'ok', label: 'tiered executor agents installed' }
      : { level: 'warning', label: `executor agents missing: ${missingAgents.join(', ')}`, detail: 'run agent-flow init --claude --force (review the diff)' },
  );

  if (await fs.pathExists(path.join(root, '.git'))) {
    const missing = await missingGitignoreEntries(root);
    checks.push(
      missing.length === 0
        ? { level: 'ok', label: '.gitignore covers agent-flow scratch' }
        : { level: 'warning', label: `.gitignore misses ${missing.length} agent-flow scratch path(s)`, detail: 'run agent-flow init' },
    );
  }

  // Observed behavior over the last week, if transcripts exist for this project.
  const since = options.since ?? new Date(Date.now() - 7 * 86_400_000);
  const { files, source } = await findTranscriptFiles({ projectPath: root, dir: options.claudeDir, since });
  if (files.length > 0) {
    const report = await buildUsageReport(files, source, { since });
    const peak = report.sessions.reduce((m, s) => Math.max(m, s.peakContext), 0);
    const idle = report.cacheBreaks.filter((b) => b.reason === 'idle').reduce((sum, b) => sum + b.cacheWrite, 0);
    const avgMain = report.main.calls > 0 ? (report.main.input + report.main.cacheWrite + report.main.cacheRead) / report.main.calls : 0;
    checks.push({
      level: peak >= 200_000 || avgMain >= 150_000 ? 'warning' : 'ok',
      label: `last 7d: peak context ${k(peak)}, avg re-read per turn ${k(avgMain)}`,
      detail: peak >= 200_000 ? 'split work: /clear between tasks, /flow-orchestrate stops at phase boundaries' : undefined,
    });
    checks.push({
      level: idle > 0 ? 'warning' : 'ok',
      label: `last 7d: ${k(idle)} tokens re-written after idle gaps`,
      detail: idle > 0 ? 'resume big sessions fresh (handoff + /clear) instead of returning cold' : undefined,
    });
  }

  return checks;
}

export async function runDoctorTokens(options: { cwd?: string } = {}): Promise<void> {
  const root = options.cwd ?? process.cwd();
  const checks = await collectTokenChecks(root);
  console.log(brandTitle('agent-flow doctor --tokens'));
  for (const c of checks) {
    console.log(`${statusLabel(c.level)} ${c.label}${c.detail ? pc.dim(` - ${c.detail}`) : ''}`);
  }
  console.log(pc.dim('Full breakdown: agent-flow usage --since 7d'));
}

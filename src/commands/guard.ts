import { getGuardConfig, guardPrompt, guardTool, type HookInput } from '../core/guard.js';

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Claude Code hook entrypoint: `agent-flow guard prompt` (UserPromptSubmit) or
 * `agent-flow guard tool` (PreToolUse, installed on executor subagents).
 * Never fails the hook: any error means "allow, say nothing".
 */
export async function runGuard(event: string, options: { cwd?: string; input?: string } = {}): Promise<void> {
  try {
    const raw = options.input ?? (await readStdin());
    const input = (raw.trim() ? JSON.parse(raw) : {}) as HookInput;
    const root = options.cwd ?? process.cwd();
    const cfg = await getGuardConfig(root);

    if (event === 'prompt') {
      const verdict = await guardPrompt(input, cfg, root);
      if (verdict.block && verdict.message) {
        console.log(JSON.stringify({ continue: false, stopReason: verdict.message, systemMessage: verdict.message }));
      } else if (verdict.message) {
        console.log(JSON.stringify({ systemMessage: verdict.message }));
      }
      return;
    }

    if (event === 'tool') {
      const verdict = await guardTool(input, cfg);
      if (verdict.deny) {
        console.log(JSON.stringify({
          hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: verdict.deny },
        }));
      }
      return;
    }
  } catch {
    // A guard must never break the session.
  }
}

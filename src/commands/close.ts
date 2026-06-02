import readline from 'node:readline/promises';
import pc from 'picocolors';
import { appendMemoryEntry } from '../core/jsonl-memory.js';
import { brandTitle, statusLabel } from '../core/terminal-ui.js';

export type CloseOptions = {
  cwd?: string;
  change?: string;
  decision?: string;
  error?: string;
  next?: string;
  module?: string;
  allowDuplicate?: boolean;
};

function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY && !process.env.CI);
}

async function ask(rl: readline.Interface, question: string): Promise<string> {
  const answer = await rl.question(`${pc.cyan('?')} ${question} `);
  return answer.trim();
}

async function saveEntry(
  root: string,
  file: 'events' | 'decisions' | 'errors',
  type: string,
  summary: string,
  options: { module?: string; allowDuplicate?: boolean },
): Promise<string | null> {
  try {
    const entry = await appendMemoryEntry(root, file, {
      type,
      summary,
      ...(options.module ? { module: options.module } : {}),
    }, { allowDuplicate: options.allowDuplicate });
    return entry.file;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Duplicate memory entry')) {
      console.log(pc.dim(`  skipped duplicate: ${summary.slice(0, 60)}`));
      return null;
    }
    throw error;
  }
}

export async function runClose(options: CloseOptions = {}): Promise<void> {
  const root = options.cwd ?? process.cwd();
  const saved: string[] = [];

  if (!isInteractive() && !options.change && !options.decision && !options.error && !options.next) {
    console.log(brandTitle('agent-flow close'));
    console.log('');
    console.log('Non-interactive mode. Provide flags to save memory:');
    console.log(`  ${pc.cyan('--change')} <summary>     What changed in this session`);
    console.log(`  ${pc.cyan('--decision')} <summary>   Decision made`);
    console.log(`  ${pc.cyan('--error')} <summary>      Error solved`);
    console.log(`  ${pc.cyan('--next')} <summary>       What the next session should know`);
    console.log(`  ${pc.cyan('--module')} <module>      Related module or area`);
    console.log(`  ${pc.cyan('--allow-duplicate')}      Allow duplicate entries`);
    return;
  }

  const memoryOptions = { module: options.module, allowDuplicate: options.allowDuplicate };

  if (options.change || options.decision || options.error || options.next) {
    console.log(brandTitle('agent-flow close'));
    console.log('');

    if (options.change) {
      const file = await saveEntry(root, 'events', 'change', options.change, memoryOptions);
      if (file) saved.push(file);
    }
    if (options.decision) {
      const file = await saveEntry(root, 'decisions', 'decision', options.decision, memoryOptions);
      if (file) saved.push(file);
    }
    if (options.error) {
      const file = await saveEntry(root, 'errors', 'error', options.error, memoryOptions);
      if (file) saved.push(file);
    }
    if (options.next) {
      const file = await saveEntry(root, 'events', 'handoff', options.next, memoryOptions);
      if (file) saved.push(file);
    }

    for (const file of saved) {
      console.log(`${statusLabel('appended')} ${file}`);
    }
    if (saved.length === 0) {
      console.log(pc.dim('No new memory entries saved.'));
    }
    return;
  }

  console.log(brandTitle('agent-flow close'));
  console.log('');
  console.log(pc.dim('Answer each question or press Enter to skip.'));
  console.log('');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    const change = await ask(rl, 'What changed in this session?');
    const decision = await ask(rl, 'Was any decision made?');
    const error = await ask(rl, 'Was any error solved?');
    const next = await ask(rl, 'What should the next session know?');

    console.log('');

    if (change) {
      const file = await saveEntry(root, 'events', 'change', change, memoryOptions);
      if (file) saved.push(file);
    }
    if (decision) {
      const file = await saveEntry(root, 'decisions', 'decision', decision, memoryOptions);
      if (file) saved.push(file);
    }
    if (error) {
      const file = await saveEntry(root, 'errors', 'error', error, memoryOptions);
      if (file) saved.push(file);
    }
    if (next) {
      const file = await saveEntry(root, 'events', 'handoff', next, memoryOptions);
      if (file) saved.push(file);
    }

    for (const file of saved) {
      console.log(`${statusLabel('appended')} ${file}`);
    }
    if (saved.length === 0) {
      console.log(pc.dim('No memory entries saved. All answers were empty.'));
    }
  } finally {
    rl.close();
  }
}

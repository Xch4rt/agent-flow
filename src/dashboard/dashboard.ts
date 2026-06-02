import readline from 'node:readline/promises';
import blessed from 'blessed';
import pc from 'picocolors';
import { createExecutionPanel } from './components/ExecutionPanel.js';
import { createFooter } from './components/Footer.js';
import { createHeader } from './components/Header.js';
import { createInfoBar } from './components/InfoBar.js';
import { createMainMenu } from './components/MainMenu.js';
import { createMemoryPanel } from './components/MemoryPanel.js';
import { createRightPanel } from './components/RightPanel.js';
import { printDashboardFallback } from './fallback.js';
import { initialDashboardState, menuItems, type DashboardState } from './state.js';
import { theme } from './theme.js';

function isInteractiveTerminal(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY && !process.env.CI);
}

function selectedMessage(label: string): string {
  switch (label) {
    case 'Start focused task':
      return 'Execution mode primed. Build a context pack, then move.';
    case 'Continue last flow':
      return 'Flow state matters. Resume from the latest project signals.';
    case 'Plan next steps':
      return 'Clarity first. Shape the next move before writing code.';
    case 'Search memory':
      return 'Memory mode active. Pull durable facts, not noise.';
    case 'Create context pack':
      return 'Context pack ready path. Reduce repetition before execution.';
    case 'Run doctor':
      return 'System check selected. Verify setup before shipping.';
    case 'Settings':
      return 'Settings selected. Keep defaults boring and reliable.';
    case 'Exit':
      return 'Exit selected. Press enter again or q to leave.';
    default:
      return 'Stay in flow. We handle the rest.';
  }
}

async function promptInput(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${pc.cyan('?')} ${question} `);
    return answer.trim();
  } finally {
    rl.close();
  }
}

async function executeAction(label: string): Promise<void> {
  const { runDoctor } = await import('../commands/doctor.js');
  const { runStart } = await import('../commands/start.js');
  const { runContext } = await import('../commands/context.js');
  const { searchMemory } = await import('../core/jsonl-memory.js');

  switch (label) {
    case 'Run doctor': {
      await runDoctor();
      break;
    }
    case 'Create context pack': {
      const task = await promptInput('Task for context pack:');
      if (!task) {
        console.log(pc.dim('No task provided.'));
        break;
      }
      await runContext(task, {});
      break;
    }
    case 'Start focused task': {
      const task = await promptInput('What are you working on?');
      if (!task) {
        console.log(pc.dim('No task provided.'));
        break;
      }
      await runStart(task, {});
      break;
    }
    case 'Search memory': {
      const query = await promptInput('Search query:');
      if (!query) {
        console.log(pc.dim('No query provided.'));
        break;
      }
      const results = await searchMemory(process.cwd(), query, { limit: 10 });
      if (results.length === 0) {
        console.log(pc.dim('No memory entries matched.'));
      } else {
        for (const entry of results) {
          console.log(`${pc.dim(`${entry.file}:${entry.line}`)} ${entry.raw.slice(0, 120)}`);
        }
      }
      break;
    }
    case 'Continue last flow': {
      const entries = await (async () => {
        const { readMemoryEntries } = await import('../core/jsonl-memory.js');
        return readMemoryEntries(process.cwd());
      })();
      const handoffs = entries.filter((e) => {
        if (typeof e.value !== 'object' || e.value === null) return false;
        return (e.value as Record<string, unknown>).type === 'handoff';
      });
      if (handoffs.length === 0) {
        console.log(pc.dim('No previous flow handoff found. Start a new task with: agent-flow start "<task>"'));
      } else {
        const last = handoffs[handoffs.length - 1];
        const value = last.value as Record<string, unknown>;
        console.log(pc.bold('Last handoff:'));
        console.log(`  ${value.summary ?? last.raw}`);
        console.log('');
        console.log(`Resume with: ${pc.cyan('agent-flow start "<your task>"')}`);
      }
      break;
    }
    case 'Settings': {
      console.log(pc.dim('Settings are not implemented yet.'));
      break;
    }
    default:
      break;
  }
}

function createLayout(screen: blessed.Widgets.Screen, state: DashboardState): void {
  for (const child of [...screen.children]) {
    child.detach();
  }

  const width = Number(screen.width);
  const height = Number(screen.height);

  if (width < 88 || height < 30) {
    screen.append(blessed.box({
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      border: 'line',
      label: ' Agent Flow ',
      tags: false,
      style: {
        fg: theme.text,
        bg: theme.panel,
        border: { fg: theme.cyan },
      },
      content: [
        'AGENT FLOW',
        'Never explain your repo twice.',
        '',
        `[ Project: ${state.project} ] [ Memory: ${state.memory} ]`,
        '',
        ...menuItems.map((item, index) => `${index === state.selectedIndex ? '>' : ' '} ${item}`),
        '',
        'Resize terminal for full dashboard.',
        '↑/↓ navigate   enter select   q exit',
      ].join('\n'),
    }));
    screen.render();
    return;
  }

  screen.append(createHeader());
  screen.append(createInfoBar(state));
  screen.append(createMainMenu(state));
  screen.append(createRightPanel());
  screen.append(createExecutionPanel());
  screen.append(createMemoryPanel());
  screen.append(createFooter(state));
  screen.render();
}

export async function runDashboard(): Promise<void> {
  const state = initialDashboardState();

  if (!isInteractiveTerminal()) {
    printDashboardFallback(state);
    return;
  }

  const screen = blessed.screen({
    smartCSR: true,
    fullUnicode: true,
    dockBorders: true,
    title: 'agent-flow',
  });

  createLayout(screen, state);

  let pendingAction: string | undefined;

  function updateSelection(nextIndex: number): void {
    state.selectedIndex = (nextIndex + menuItems.length) % menuItems.length;
    state.message = selectedMessage(menuItems[state.selectedIndex] ?? '');
    createLayout(screen, state);
  }

  screen.key(['up', 'k'], () => updateSelection(state.selectedIndex - 1));
  screen.key(['down', 'j'], () => updateSelection(state.selectedIndex + 1));
  screen.key(['enter'], () => {
    const selected = menuItems[state.selectedIndex];
    if (selected === 'Exit') {
      screen.destroy();
      return;
    }
    if (selected === 'Plan next steps') {
      state.status = 'working';
      state.message = selectedMessage(selected);
      createLayout(screen, state);
      return;
    }
    pendingAction = selected;
    screen.destroy();
  });
  screen.key(['escape', 'q', 'C-c'], () => screen.destroy());
  screen.on('resize', () => createLayout(screen, state));

  await new Promise<void>((resolve) => {
    screen.once('destroy', resolve);
  });

  if (pendingAction) {
    console.log('');
    await executeAction(pendingAction);
  }
}

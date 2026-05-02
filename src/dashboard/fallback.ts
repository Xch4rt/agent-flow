import { compactDogs } from './ascii.js';
import type { DashboardState } from './state.js';
import { c } from './theme.js';

export function printDashboardFallback(state: DashboardState): void {
  console.log(c.title('AGENT FLOW'));
  console.log(c.yellow('Never explain your repo twice.'));
  console.log('');
  console.log(c.cyan(compactDogs));
  console.log(c.muted(`[ Project: ${state.project} ] [ Branch: ${state.branch} ] [ Memory: ${state.memory} ] [ Status: ${state.status} ]`));
  console.log('');
  console.log(c.yellow('WHAT DO YOU WANT TO DO?'));
  console.log(c.cyan('> Start focused task'));
  console.log('  Continue last flow');
  console.log('  Plan next steps');
  console.log('  Search memory');
  console.log('  Create context pack');
  console.log('  Run doctor');
  console.log('  Settings');
  console.log('  Exit');
  console.log('');
  console.log(c.muted('Run in an interactive terminal for arrow-key navigation.'));
}

import blessed from 'blessed';
import { c, panelStyle, theme } from '../theme.js';
import type { DashboardState } from '../state.js';

export function createInfoBar(state: DashboardState): blessed.Widgets.BoxElement {
  return blessed.box({
    top: 12,
    left: 0,
    width: '100%',
    height: 3,
    border: 'line',
    tags: false,
    style: panelStyle(theme.yellow),
    content: [
      c.cyan(`[ Project: ${state.project} ]`),
      c.yellow(`[ Branch: ${state.branch} ]`),
      c.purple(`[ Memory: ${state.memory} ]`),
      c.green(`[ Status: ${state.status} ]`),
    ].join('  '),
  });
}


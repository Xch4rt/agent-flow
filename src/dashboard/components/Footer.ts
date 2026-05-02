import blessed from 'blessed';
import { c, panelStyle, theme } from '../theme.js';
import type { DashboardState } from '../state.js';

export function createFooter(state: DashboardState): blessed.Widgets.BoxElement {
  return blessed.box({
    bottom: 0,
    left: 0,
    width: '100%',
    height: '11%',
    border: 'line',
    label: ' Archon Mode ',
    tags: false,
    style: panelStyle(theme.yellow),
    content: [
      `${c.yellow('ARCHON MODE')} ${c.muted('(AUTO SWITCH)')}`,
      `${c.cyan('(🐶)')} <-> ${c.purple('(💜)')}`,
      `${c.text('"We execute when needed."')}  ${c.text('"We remember when it matters."')}`,
      c.yellow(state.message),
    ].join('\n'),
  });
}


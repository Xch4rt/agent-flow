import blessed from 'blessed';
import { c, panelStyle, theme } from '../theme.js';
import { menuItems, type DashboardState } from '../state.js';

export function createMainMenu(state: DashboardState): blessed.Widgets.BoxElement {
  const lines = [
    c.yellow('WHAT DO YOU WANT TO DO?'),
    '',
    ...menuItems.map((item, index) => {
      const selected = index === state.selectedIndex;
      return selected ? c.cyan.bold(`> ${item}`) : c.muted(`  ${item}`);
    }),
    '',
    c.muted('↑/↓ navigate   enter select   q exit'),
  ];

  return blessed.box({
    top: 15,
    left: 0,
    width: '40%',
    height: '42%',
    border: 'line',
    label: ' Main Menu ',
    tags: false,
    style: panelStyle(theme.cyan),
    content: lines.join('\n'),
  });
}


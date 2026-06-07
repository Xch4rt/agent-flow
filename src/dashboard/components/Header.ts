import blessed from 'blessed';
import { c, panelStyle, theme } from '../theme.js';

export function createHeader(): blessed.Widgets.BoxElement {
  const header = blessed.box({
    top: 0,
    left: 0,
    width: '100%',
    height: 12,
    tags: false,
    style: panelStyle(theme.cyan),
  });

  header.append(blessed.box({
    top: 1,
    left: 1,
    width: '98%',
    height: 10,
    border: 'line',
    label: ' AGENT FLOW ',
    tags: false,
    style: panelStyle(theme.cyan),
    content: [
      c.title('AGENT FLOW'),
      c.yellow('Never explain your repo twice.'),
      '',
      `${c.cyan('Execution')}  plan → harden → orchestrate, with gates that don't lie`,
      `${c.purple('Memory')}     project context that survives across sessions`,
    ].join('\n'),
  }));

  return header;
}

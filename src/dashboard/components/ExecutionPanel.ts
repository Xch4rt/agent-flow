import blessed from 'blessed';
import { c, panelStyle, theme } from '../theme.js';

export function createExecutionPanel(): blessed.Widgets.BoxElement {
  return blessed.box({
    top: '57%',
    left: 0,
    width: '50%',
    height: '32%',
    border: 'line',
    label: ' Execution Mode ',
    tags: false,
    style: panelStyle(theme.cyan),
    content: [
      c.cyan('EXECUTION MODE'),
      c.muted('(Bolt)'),
      '',
      c.text('"Locked in. Let\'s go."'),
      c.text('"I\'ll help you move fast."'),
      '',
      c.yellow('Checklist:'),
      `${c.green('[x]')} Scanning codebase`,
      `${c.green('[x]')} Understanding structure`,
      `${c.muted('[ ]')} Building solution`,
      `${c.muted('[ ]')} Testing`,
      `${c.muted('[ ]')} Ship it`,
    ].join('\n'),
  });
}


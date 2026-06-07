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
      c.muted('scoped envelopes, deterministic gates'),
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


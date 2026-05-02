import blessed from 'blessed';
import { c, panelStyle, theme } from '../theme.js';

export function createRightPanel(): blessed.Widgets.BoxElement {
  return blessed.box({
    top: 15,
    left: '40%',
    width: '60%',
    height: '42%',
    border: 'line',
    label: ' System ',
    tags: false,
    style: panelStyle(theme.purple),
    content: [
      c.yellow('AGENT FLOW SYSTEM:'),
      '',
      `${c.cyan('⚡ Execution engine')}`,
      `${c.purple('🧠 Memory system')}`,
      `${c.purple('💜 Dual-agent coordination')}`,
      '',
      c.muted("Type 'help' to see all commands"),
      '',
      c.text('Execute with clarity.'),
      c.text('Remember what matters.'),
      c.text('Maintain flow state across sessions.'),
      c.text('Eliminate repetition and context loss.'),
    ].join('\n'),
  });
}


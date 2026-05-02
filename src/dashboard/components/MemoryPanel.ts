import blessed from 'blessed';
import { c, panelStyle, theme } from '../theme.js';

export function createMemoryPanel(): blessed.Widgets.BoxElement {
  return blessed.box({
    top: '57%',
    left: '50%',
    width: '50%',
    height: '32%',
    border: 'line',
    label: ' Memory Mode ',
    tags: false,
    style: panelStyle(theme.purple),
    content: [
      c.purple('MEMORY MODE'),
      c.muted('(Luna)'),
      '',
      c.text('"I got this. Let me check..."'),
      c.text('"I remember what matters."'),
      '',
      c.yellow('Memory example:'),
      'Found 3 relevant memories:',
      `${c.purple('1.')} JSONL is the source of truth`,
      `${c.purple('2.')} SQLite is for fast queries only`,
      `${c.purple('3.')} Invalid memories are skipped`,
    ].join('\n'),
  });
}


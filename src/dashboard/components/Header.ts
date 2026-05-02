import blessed from 'blessed';
import { c, panelStyle, theme } from '../theme.js';
import { createDogMascots } from './DogMascots.js';

export function createHeader(): blessed.Widgets.BoxElement {
  const header = blessed.box({
    top: 0,
    left: 0,
    width: '100%',
    height: 12,
    tags: false,
    style: panelStyle(theme.cyan),
  });

  header.append(createDogMascots());
  header.append(blessed.box({
    top: 1,
    left: '60%',
    width: '39%',
    height: 10,
    border: 'line',
    label: ' AGENT FLOW ',
    tags: false,
    style: panelStyle(theme.cyan),
    content: [
      c.title('AGENT FLOW'),
      c.yellow('Never explain your repo twice.'),
      '',
      `${c.cyan('Bolt')}: "Yo! Let\'s work together! 💪"`,
      `${c.purple('Luna')}: "Hey! I\'ll remember the important stuff 🧠"`,
    ].join('\n'),
  }));

  return header;
}


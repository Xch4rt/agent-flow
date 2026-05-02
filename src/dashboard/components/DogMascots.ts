import blessed from 'blessed';
import { c, panelStyle, theme } from '../theme.js';

export function createDogMascots(): blessed.Widgets.BoxElement {
  const art = [
    `${c.cyan('     /^^^\\__')}   ${c.yellow('<>')}   ${c.purple('    /^^^^^^\\___')}`,
    `${c.cyan('    / o  o  \\')}        ${c.purple('   /  o    o   \\')}`,
    `${c.cyan('   |   __   |')}        ${c.purple('  |     __      |')}`,
    `${c.cyan('   | \\____/ |')}        ${c.purple('  |   \\____/    |')}`,
    `${c.cyan('    \\_    _/')}         ${c.purple('   \\_        __/')}`,
    `${c.cyan('   __|_||_|__')}       ${c.purple('    __|______|__')}`,
    c.muted('__/___|__|___\\_______/____|____|____\\__'),
    `${c.cyan(' Bolt')} ${c.muted('execution')}          ${c.purple('Luna')} ${c.muted('memory')}`,
  ].join('\n');

  return blessed.box({
    top: 1,
    left: 1,
    width: '58%',
    height: 10,
    tags: true,
    border: 'line',
    label: ' Bolt + Luna ',
    style: panelStyle(theme.purple),
    content: art,
  });
}

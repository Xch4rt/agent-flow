import chalk from 'chalk';

export const theme = {
  bg: '#05070d',
  panel: '#0b1020',
  panelAlt: '#101527',
  text: '#d7e1ff',
  muted: '#7f8aa3',
  cyan: '#00e5ff',
  purple: '#a855f7',
  yellow: '#facc15',
  green: '#22c55e',
  red: '#fb7185',
};

export const c = {
  title: chalk.hex(theme.cyan).bold,
  tagline: chalk.hex(theme.muted),
  cyan: chalk.hex(theme.cyan),
  purple: chalk.hex(theme.purple),
  yellow: chalk.hex(theme.yellow),
  green: chalk.hex(theme.green),
  muted: chalk.hex(theme.muted),
  text: chalk.hex(theme.text),
  bold: chalk.bold,
};

export function panelStyle(borderColor = theme.cyan) {
  return {
    fg: theme.text,
    bg: theme.panel,
    border: {
      fg: borderColor,
    },
  };
}


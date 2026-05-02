import pc from 'picocolors';

export function brandTitle(label: string): string {
  return [
    `${pc.cyan(pc.bold(label))} ${pc.dim('▣')}`,
    pc.dim('voxel workflow agent / memory / context'),
  ].join('\n');
}

export function section(label: string): string {
  return pc.bold(label);
}

export function statusLabel(status: 'created' | 'overwritten' | 'skipped' | 'appended' | 'ok' | 'fail' | 'warning'): string {
  switch (status) {
    case 'created':
      return pc.green('created');
    case 'overwritten':
      return pc.yellow('overwritten');
    case 'skipped':
      return pc.dim('skipped');
    case 'appended':
      return pc.green('appended');
    case 'ok':
      return pc.green('ok');
    case 'fail':
      return pc.red('fail');
    case 'warning':
      return pc.yellow('warning');
  }
}

export function keyValue(label: string, value: string): string {
  return `${pc.dim(label)} ${value}`;
}

export function printFirstRunAgent(): void {
  console.log(`${pc.cyan('     /^^^\\__')}   ${pc.yellow('<>')}   ${pc.magenta('    /^^^^^^\\___')}`);
  console.log(`${pc.cyan('    / o  o  \\')}        ${pc.magenta('   /  o    o   \\')}   ${pc.bold('agent-flow')}`);
  console.log(`${pc.cyan('   |   __   |')}        ${pc.magenta('  |     __      |')}  ${pc.dim('Bolt + Luna online')}`);
  console.log(`${pc.cyan('   | \\____/ |')}        ${pc.magenta('  |   \\____/    |')}`);
  console.log(`${pc.cyan('    \\_    _/')}         ${pc.magenta('   \\_        __/')}  ${pc.dim('execution + memory')}`);
  console.log(`${pc.dim('_____|__||__|___________|____||____|_____')}`);
  console.log('');
}

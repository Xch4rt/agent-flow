import pc from 'picocolors';
import { onboardRepository } from '../core/onboard.js';
import { brandTitle, keyValue, statusLabel } from '../core/terminal-ui.js';

export type OnboardOptions = {
  cwd?: string;
  refresh?: boolean;
  dryRun?: boolean;
  force?: boolean;
};

export async function runOnboard(options: OnboardOptions = {}): Promise<void> {
  const root = options.cwd ?? process.cwd();
  const result = await onboardRepository(root, options);

  console.log(brandTitle(options.dryRun ? 'agent-flow onboard dry run' : 'agent-flow onboard'));
  console.log(keyValue('Package manager:', result.inspection.detection.packageManager));
  console.log(
    keyValue('Detected stack:', result.inspection.detection.stacks.length ? result.inspection.detection.stacks.join(', ') : 'none'),
  );
  console.log(keyValue('Important files:', String(result.inspection.importantFiles.length)));
  console.log(keyValue('Important directories:', String(result.inspection.importantDirectories.length)));
  console.log(keyValue('Risks:', String(result.inspection.risks.length)));

  for (const item of result.planning) {
    const status = item.changed ? (options.dryRun ? 'would update' : 'updated') : 'unchanged';
    console.log(`${item.changed ? pc.green(status) : pc.dim(status)} ${item.path}`);
  }

  if (options.dryRun) {
    console.log(pc.dim('dry run: no files were modified'));
    return;
  }

  if (result.memoryAppended.length > 0) {
    for (const file of result.memoryAppended) {
      console.log(`${statusLabel('appended')} ${file}`);
    }
  } else if (result.skippedMemory) {
    console.log(pc.dim('skipped memory append; onboarding event already exists. Use --refresh to append a new event.'));
  }
}

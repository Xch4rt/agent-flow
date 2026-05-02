import fs from 'node:fs';
import path from 'node:path';

export const menuItems = [
  'Start focused task',
  'Continue last flow',
  'Plan next steps',
  'Search memory',
  'Create context pack',
  'Run doctor',
  'Settings',
  'Exit',
];

export type DashboardState = {
  selectedIndex: number;
  project: string;
  branch: string;
  memory: 'synced' | 'stale' | 'missing';
  status: 'ready' | 'working';
  message: string;
};

function readProjectName(cwd: string): string {
  const packageJsonPath = path.join(cwd, 'package.json');

  if (fs.existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { name?: unknown };
      if (typeof packageJson.name === 'string' && packageJson.name.trim()) {
        return packageJson.name.trim();
      }
    } catch {
      // Fall back to the folder name when package metadata is unavailable.
    }
  }

  return path.basename(cwd);
}

export function initialDashboardState(cwd = process.cwd()): DashboardState {
  return {
    selectedIndex: 0,
    project: readProjectName(cwd),
    branch: 'main',
    memory: 'synced',
    status: 'ready',
    message: "Stay in flow. We handle the rest.",
  };
}

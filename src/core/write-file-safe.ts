import path from 'node:path';
import fs from 'fs-extra';

export type WriteResult = {
  path: string;
  status: 'created' | 'overwritten' | 'skipped';
};

export async function writeFileSafe(
  targetPath: string,
  content: string,
  options: { force?: boolean } = {},
): Promise<WriteResult> {
  const exists = await fs.pathExists(targetPath);

  if (exists && !options.force) {
    return { path: targetPath, status: 'skipped' };
  }

  await fs.ensureDir(path.dirname(targetPath));
  await fs.writeFile(targetPath, content);

  return {
    path: targetPath,
    status: exists ? 'overwritten' : 'created',
  };
}

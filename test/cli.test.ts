import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProgram, isCliEntrypoint } from '../src/cli.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-flow-cli-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('CLI entrypoint', () => {
  it('detects execution through a bin symlink by comparing real paths', async () => {
    const realCli = path.join(tmpDir, 'dist-cli.js');
    const binLink = path.join(tmpDir, 'agent-flow');
    await fs.writeFile(realCli, '#!/usr/bin/env node\n');
    await fs.symlink(realCli, binLink);

    expect(isCliEntrypoint(pathToFileURL(realCli).href, binLink)).toBe(true);
  });

  it('keeps createProgram testable with version and help output', () => {
    const program = createProgram();

    expect(program.version()).toBe('0.5.0');
    expect(program.helpInformation()).toContain('agent-flow');
    expect(program.helpInformation()).toContain('memory');
  });
});

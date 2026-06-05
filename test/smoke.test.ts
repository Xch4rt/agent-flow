import path from 'node:path';
import os from 'node:os';
import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runInit } from '../src/commands/init.js';
import { runGates } from '../src/core/gates.js';
import { runSmoke, type SmokeConfig } from '../src/core/smoke.js';

let tmpDir: string;

// A tiny server: GET /health -> 200 "ok"; everything else -> 201 with a Location header.
function serverStart(port: number): string {
  const body = `const http=require('http');http.createServer((q,s)=>{if(q.url==='/health'){s.writeHead(200);s.end('ok')}else{s.writeHead(201,{location:'https://x'});s.end('{}')}}).listen(${port})`;
  return `node -e "${body}"`;
}

async function setSmoke(root: string, smoke: SmokeConfig): Promise<void> {
  const configPath = path.join(root, '.agent-flow', 'config.json');
  const config = await fs.readJson(configPath);
  config.orchestration = { ...(config.orchestration ?? {}), smoke };
  await fs.writeJson(configPath, config, { spaces: 2 });
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-flow-smoke-test-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  process.exitCode = 0;
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  await fs.remove(tmpDir);
});

describe('runSmoke', () => {
  it('boots the app, probes it, and passes when the app is healthy', async () => {
    const port = 47911;
    const result = await runSmoke(tmpDir, {
      start: serverStart(port),
      baseUrl: `http://localhost:${port}`,
      readyPath: '/health',
      readyTimeoutMs: 8000,
      probes: [
        { name: 'health', path: '/health', status: 200 },
        { name: 'redirect', path: '/abc', status: 201, headerIncludes: { location: 'https://x' } },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.steps.find((s) => s.name === 'ready')?.ok).toBe(true);
  });

  it('fails when the app never starts (broken entrypoint)', async () => {
    const result = await runSmoke(tmpDir, {
      start: 'node -e "process.exit(0)"', // exits immediately, never listens
      baseUrl: 'http://localhost:47912',
      readyTimeoutMs: 1500,
      probes: [{ path: '/', status: 200 }],
    });
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('did not start');
  });

  it('fails when a probe status does not match', async () => {
    const port = 47913;
    const result = await runSmoke(tmpDir, {
      start: serverStart(port),
      baseUrl: `http://localhost:${port}`,
      readyPath: '/health',
      readyTimeoutMs: 8000,
      probes: [{ name: 'wrong', path: '/health', status: 404 }], // server returns 200
    });
    expect(result.ok).toBe(false);
    expect(result.steps.find((s) => s.name === 'wrong')?.ok).toBe(false);
  });
});

describe('smoke gate integration', () => {
  it('runGates runs the built-in smoke gate from config', async () => {
    await runInit({ codex: true, cwd: tmpDir });
    const port = 47914;
    await setSmoke(tmpDir, {
      start: serverStart(port),
      baseUrl: `http://localhost:${port}`,
      readyPath: '/health',
      readyTimeoutMs: 8000,
      probes: [{ name: 'health', path: '/health', status: 200 }],
    });
    const run = await runGates(tmpDir, ['smoke']);
    expect(run.ok).toBe(true);
    expect(run.results[0].command).toBe('(built-in smoke)');
  });
});

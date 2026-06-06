import { execa, type ResultPromise } from 'execa';
import { readConfig } from './config.js';

/**
 * Built-in smoke gate: boot the app, wait until it answers, run real HTTP
 * probes, then tear it down. Closes the "tests pass with inject but the app is
 * actually broken" hole (e.g. a wrong start entrypoint).
 */

export type SmokeProbe = {
  name?: string;
  method?: string;
  path: string;
  /** Request body to send (e.g. a JSON payload for POST probes). */
  body?: string;
  /** Request headers. When a body is set, content-type defaults to application/json. */
  headers?: Record<string, string>;
  /** Acceptable status(es). A single number, or a list. */
  status: number | number[];
  headerIncludes?: Record<string, string>;
};

export type SmokeConfig = {
  start: string;
  env?: Record<string, string>;
  baseUrl: string;
  readyPath?: string;
  readyTimeoutMs?: number;
  probes: SmokeProbe[];
};

export type SmokeResult = {
  ok: boolean;
  summary: string;
  steps: Array<{ name: string; ok: boolean; detail: string }>;
};

export async function getSmokeConfig(root: string): Promise<SmokeConfig | null> {
  const config = await readConfig(root);
  const orchestration = (config?.orchestration ?? {}) as { smoke?: SmokeConfig | null };
  const smoke = orchestration.smoke;
  if (!smoke || typeof smoke !== 'object' || typeof smoke.start !== 'string' || typeof smoke.baseUrl !== 'string') {
    return null;
  }
  return smoke;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function statusMatches(status: number, expected: number | number[]): boolean {
  return Array.isArray(expected) ? expected.includes(status) : status === expected;
}

async function waitForReady(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url, { method: 'GET' });
      return true; // any HTTP response means the server is up
    } catch {
      await sleep(150);
    }
  }
  return false;
}

function killTree(proc: ResultPromise): void {
  const pid = proc.pid;
  try {
    if (pid) process.kill(-pid, 'SIGTERM'); // kill the detached process group
  } catch {
    try {
      proc.kill('SIGTERM');
    } catch {
      // already gone
    }
  }
}

export async function runSmoke(root: string, cfg: SmokeConfig): Promise<SmokeResult> {
  const steps: SmokeResult['steps'] = [];
  const readyTimeoutMs = cfg.readyTimeoutMs ?? 15000;
  const readyUrl = `${cfg.baseUrl}${cfg.readyPath ?? '/'}`;

  const proc = execa(cfg.start, {
    cwd: root,
    shell: true,
    detached: true,
    reject: false,
    all: true,
    env: { ...process.env, ...(cfg.env ?? {}) },
  });

  try {
    const ready = await waitForReady(readyUrl, readyTimeoutMs);
    steps.push({
      name: 'ready',
      ok: ready,
      detail: ready ? `responded at ${readyUrl}` : `no response within ${readyTimeoutMs}ms at ${readyUrl}`,
    });
    if (!ready) {
      return { ok: false, summary: 'app did not start', steps };
    }

    for (const probe of cfg.probes) {
      const name = probe.name ?? `${probe.method ?? 'GET'} ${probe.path}`;
      try {
        const headers: Record<string, string> = { ...(probe.headers ?? {}) };
        if (probe.body !== undefined && !Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
          headers['content-type'] = 'application/json';
        }
        const res = await fetch(`${cfg.baseUrl}${probe.path}`, {
          method: probe.method ?? 'GET',
          redirect: 'manual',
          body: probe.body,
          headers,
        });
        let ok = statusMatches(res.status, probe.status);
        let detail = `status ${res.status} (want ${JSON.stringify(probe.status)})`;
        if (ok && probe.headerIncludes) {
          for (const [key, value] of Object.entries(probe.headerIncludes)) {
            const actual = res.headers.get(key) ?? '';
            if (!actual.includes(value)) {
              ok = false;
              detail += `; header ${key} "${actual}" missing "${value}"`;
            }
          }
        }
        steps.push({ name, ok, detail });
      } catch (err) {
        steps.push({ name, ok: false, detail: `request failed: ${(err as Error).message}` });
      }
    }
  } finally {
    killTree(proc);
    await proc.catch(() => undefined);
  }

  const failed = steps.filter((s) => !s.ok).length;
  return {
    ok: failed === 0,
    summary: failed === 0 ? `${steps.length} smoke step(s) passed` : `${failed} smoke step(s) failed`,
    steps,
  };
}

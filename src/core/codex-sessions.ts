import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import fs from 'fs-extra';

/**
 * Where Codex keeps its session rollouts and how to read them.
 *
 * `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<timestamp>-<thread-id>.jsonl`
 * (plus `archived_sessions/`). Rollouts older than ~7 days may be replaced by
 * a zstd-compressed `.jsonl.zst` copy; Node ≥ 22.15 can decode those with
 * zlib, older Nodes skip them.
 */

export function codexHome(): string {
  return process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex');
}

export const ROLLOUT_FILE = /^rollout-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})-([0-9a-f-]{36})\.jsonl(\.zst)?$/;

export function isRolloutFile(file: string): boolean {
  return ROLLOUT_FILE.test(path.basename(file));
}

/** Thread id encoded in a rollout file name. */
export function threadIdFromFile(file: string): string | undefined {
  return ROLLOUT_FILE.exec(path.basename(file))?.[2];
}

export function isCompressedRollout(file: string): boolean {
  return file.endsWith('.jsonl.zst');
}

type ZstdZlib = typeof zlib & { zstdDecompressSync?: (buffer: Buffer) => Buffer };

export function canReadCompressedRollouts(): boolean {
  return typeof (zlib as ZstdZlib).zstdDecompressSync === 'function';
}

/** Whole rollout as text; null when it is compressed and this Node cannot decode zstd. */
export async function readRolloutText(file: string): Promise<string | null> {
  if (!isCompressedRollout(file)) return fs.readFile(file, 'utf8');
  const decompress = (zlib as ZstdZlib).zstdDecompressSync;
  if (!decompress) return null;
  try {
    return decompress(await fs.readFile(file)).toString('utf8');
  } catch {
    return null;
  }
}

/** Every rollout file under `sessions/` and `archived_sessions/`, newest directories first. */
export async function listRolloutFiles(dir = codexHome(), options: { since?: Date } = {}): Promise<string[]> {
  const out: string[] = [];
  const cutoff = options.since?.getTime();
  for (const sub of ['sessions', 'archived_sessions']) {
    const base = path.join(dir, sub);
    if (!(await fs.pathExists(base))) continue;
    const walk = async (current: string, depth: number): Promise<void> => {
      let entries: fs.Dirent[];
      try {
        entries = await fs.readdir(current, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory() && depth < 3) await walk(full, depth + 1);
        else if (entry.isFile() && isRolloutFile(entry.name)) {
          if (cutoff !== undefined) {
            try {
              if ((await fs.stat(full)).mtimeMs < cutoff) continue;
            } catch {
              continue;
            }
          }
          out.push(full);
        }
      }
    };
    await walk(base, 0);
  }
  return out.sort();
}

/**
 * The rollout of one thread (e.g. a spawned subagent) by its id. Day folders
 * are scanned newest first; the first match wins. Plain `.jsonl` is preferred
 * over a compressed twin.
 */
export async function findRolloutByThreadId(threadId: string, dir = codexHome()): Promise<string | undefined> {
  const files = await listRolloutFiles(dir);
  const matches = files.filter((f) => threadIdFromFile(f) === threadId);
  if (matches.length === 0) return undefined;
  return matches.find((f) => !isCompressedRollout(f)) ?? matches[0];
}

/** First JSON line of a rollout (its `session_meta`), read without loading the whole file. */
export async function readSessionMeta(file: string): Promise<Record<string, unknown> | null> {
  try {
    let head: string;
    if (isCompressedRollout(file)) {
      const text = await readRolloutText(file);
      if (text === null) return null;
      head = text.slice(0, 64 * 1024);
    } else {
      const handle = await fs.promises.open(file, 'r');
      try {
        const buffer = Buffer.alloc(64 * 1024);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        head = buffer.toString('utf8', 0, bytesRead);
      } finally {
        await handle.close();
      }
    }
    for (const line of head.split('\n')) {
      if (!line.trim().startsWith('{')) continue;
      try {
        const row = JSON.parse(line);
        if (row?.type === 'session_meta' && row.payload && typeof row.payload === 'object') return row.payload as Record<string, unknown>;
      } catch {
        // A truncated last line of the head: the session_meta is always the first line, so stop.
        return null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

import fs from 'fs-extra';

/**
 * Shared helpers for commands that ingest agent JSON output
 * (review record --from-json, plan harden --from-json).
 */

/** Read a source argument: a file path, or "-" for stdin. */
export async function readJsonSource(fromJson: string): Promise<string> {
  if (fromJson === '-') {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString('utf8');
  }
  return fs.readFile(fromJson, 'utf8');
}

/** Pull the last JSON object out of agent output (which may have prose around it). */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('no JSON object found in agent output');
  }
}

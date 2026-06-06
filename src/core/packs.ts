import type { Task } from './plan-schema.js';

/**
 * Pitfall packs: curated, deterministic domain-hardening checklists. When a
 * task's scope/gates/wording match a pack, `plan validate` warns about
 * acceptance criteria the task is missing for that domain — the same knowledge
 * a domain researcher would surface, at zero token cost.
 *
 * A task can waive a criterion ("waives": ["http-api/redirect-cache"]) or a
 * whole pack ("waives": ["http-api"]) when the omission is a conscious call.
 */

export type PackCriterion = {
  id: string;
  /** Suggested acceptance-criterion wording (also shown in warnings). */
  text: string;
  /** Criterion only applies when the task's text matches (default: always). */
  appliesWhen?: RegExp;
  /** Substrings (lowercase) — any hit in the task's acceptance satisfies it. */
  satisfiedBy: string[];
};

export type PitfallPack = {
  id: string;
  title: string;
  match: { scope?: RegExp; gates?: string[]; keywords?: RegExp };
  criteria: PackCriterion[];
};

export const BUILTIN_PACKS: PitfallPack[] = [
  {
    id: 'http-api',
    title: 'HTTP API hardening',
    match: {
      scope: /server|api|route|http|endpoint|handler/i,
      gates: ['smoke'],
      keywords: /\bhttp\b|server|api|endpoint|rest\b/i,
    },
    criteria: [
      {
        id: 'input-validation',
        text: 'Invalid or malformed input (including malformed JSON bodies) is rejected with an explicit 4xx, and the server keeps serving.',
        satisfiedBy: ['400', '422', 'invalid', 'malformed', 'reject', 'validat'],
      },
      {
        id: 'body-cap',
        text: 'Request bodies are size-capped; oversized payloads are rejected (e.g. 413) instead of buffered unbounded.',
        satisfiedBy: ['413', 'size cap', 'body cap', 'size limit', 'body limit', 'max body', 'payload too large', 'oversiz'],
      },
      {
        id: 'redirect-cache',
        text: 'Redirect (3xx) responses set explicit cache behavior (e.g. Cache-Control: no-store) so browsers cannot cache a destination permanently.',
        appliesWhen: /redirect|301|302|307|location/i,
        satisfiedBy: ['cache-control', 'no-store', 'cache control'],
      },
      {
        id: 'url-scheme-allowlist',
        text: 'User-supplied URLs are restricted to an http/https allowlist after parsing (javascript:, data:, file: blocked).',
        appliesWhen: /\burl\b|link|redirect/i,
        satisfiedBy: ['allowlist', 'javascript:', 'protocol', 'scheme', 'http/https', 'https only', 'http and https'],
      },
    ],
  },
  {
    id: 'persistence',
    title: 'File/data persistence hardening',
    match: {
      scope: /store|storage|persist|repo|db|database/i,
      keywords: /persist|store\b|storage|database|file-backed|json file|survive restart/i,
    },
    criteria: [
      {
        id: 'atomic-write',
        text: 'Writes are atomic (write-to-temp then rename) so a crash mid-write cannot corrupt stored data.',
        satisfiedBy: ['atomic', 'rename', 'write-then-rename', 'tmp then'],
      },
      {
        id: 'concurrent-writes',
        text: 'Concurrent writes are serialized (queue/lock) so simultaneous updates are neither lost nor corrupt the file.',
        satisfiedBy: ['concurrent', 'serializ', 'write queue', 'lock', 'race'],
      },
      {
        id: 'missing-file-boot',
        text: 'First boot with no data file works: a missing file is treated as an empty store, not a crash.',
        satisfiedBy: ['enoent', 'missing file', 'first boot', 'no file', 'empty store', 'file does not exist', 'file absent'],
      },
    ],
  },
  {
    id: 'auth-secrets',
    title: 'Auth & secrets hardening',
    match: {
      scope: /auth|login|session|password|token/i,
      keywords: /\bauth|login|password|session|secret|token|credential/i,
    },
    criteria: [
      {
        id: 'password-hashing',
        text: 'Passwords/secrets are stored hashed with a slow KDF (bcrypt/argon2/scrypt), never plaintext or fast hashes.',
        appliesWhen: /password|credential/i,
        satisfiedBy: ['bcrypt', 'argon', 'scrypt', 'hashed', 'never plaintext', 'kdf'],
      },
      {
        id: 'secret-logging',
        text: 'Secrets, tokens, and credentials never appear in logs or error messages.',
        satisfiedBy: ['never logged', 'redact', 'not logged', 'no secrets in log'],
      },
    ],
  },
  {
    id: 'randomness',
    title: 'Identifier/token randomness',
    match: {
      keywords: /random|slug|token|nonce|uuid|unique id|identifier generation/i,
    },
    criteria: [
      {
        id: 'crypto-random',
        text: 'Generated identifiers/tokens use crypto-grade randomness (crypto.randomBytes / randomUUID), never Math.random.',
        satisfiedBy: ['crypto.randombytes', 'randombytes', 'randomuuid', 'crypto-grade', 'csprng', 'getrandomvalues', 'not math.random'],
      },
    ],
  },
];

/** All text the matchers look at: title + scope files + acceptance wording. */
function taskCorpus(task: Task): string {
  return [task.title, ...task.scope, ...task.acceptance.map((a) => a.text)].join(' ').toLowerCase();
}

function acceptanceCorpus(task: Task): string {
  return task.acceptance.map((a) => a.text).join(' ').toLowerCase();
}

export function packMatchesTask(pack: PitfallPack, task: Task): boolean {
  if (pack.match.scope && task.scope.some((file) => pack.match.scope!.test(file))) return true;
  if (pack.match.gates && task.gates.some((gate) => pack.match.gates!.includes(gate))) return true;
  if (pack.match.keywords && pack.match.keywords.test(taskCorpus(task))) return true;
  return false;
}

export function matchPacks(task: Task, packs: PitfallPack[] = BUILTIN_PACKS): PitfallPack[] {
  return packs.filter((pack) => packMatchesTask(pack, task));
}

export type HardeningGap = {
  packId: string;
  packTitle: string;
  criterionId: string;
  /** "packId/criterionId" — the key used by waives entries. */
  key: string;
  text: string;
};

function isWaived(task: Task, packId: string, criterionId: string): boolean {
  return task.waives.includes(packId) || task.waives.includes(`${packId}/${criterionId}`);
}

/**
 * Applicable-but-uncovered hardening criteria for a task: matched packs,
 * criteria whose appliesWhen hits, minus those satisfied by acceptance
 * wording, minus explicit waivers.
 */
export function hardeningGaps(task: Task, packs: PitfallPack[] = BUILTIN_PACKS): HardeningGap[] {
  const corpus = taskCorpus(task);
  const acceptance = acceptanceCorpus(task);
  const gaps: HardeningGap[] = [];

  for (const pack of matchPacks(task, packs)) {
    for (const criterion of pack.criteria) {
      if (criterion.appliesWhen && !criterion.appliesWhen.test(corpus)) continue;
      if (isWaived(task, pack.id, criterion.id)) continue;
      if (criterion.satisfiedBy.some((needle) => acceptance.includes(needle))) continue;
      gaps.push({
        packId: pack.id,
        packTitle: pack.title,
        criterionId: criterion.id,
        key: `${pack.id}/${criterion.id}`,
        text: criterion.text,
      });
    }
  }

  return gaps;
}

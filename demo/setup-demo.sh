#!/usr/bin/env bash
# Deterministic fixtures for the VHS demo tapes. Each tape gets its own
# scratch dir under /tmp so recordings are reproducible from a clean slate.
set -euo pipefail

CLI="${AGENT_FLOW_CLI:-agent-flow}"

# --- 1. quickstart: a small real Node project, agent-flow not installed yet ---
# The tape runs init (chooser) → onboard → doctor --tokens → plan init → validate → show.
rm -rf /tmp/afdemo-quickstart
mkdir -p /tmp/afdemo-quickstart/src /tmp/afdemo-quickstart/test
cd /tmp/afdemo-quickstart && git init -q
cat > package.json <<'EOF'
{
  "name": "linklite",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "node src/server.js",
    "test": "node --test 'test/**/*.test.js'"
  },
  "dependencies": { "express": "^5.1.0" }
}
EOF
echo '{ "name": "linklite", "lockfileVersion": 3, "packages": {} }' > package-lock.json
cat > src/server.js <<'EOF'
import express from 'express';

export const app = express();
app.use(express.json());

if (process.argv[1]?.endsWith('server.js')) app.listen(3000);
EOF
cat > test/server.test.js <<'EOF'
import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/server.js';

test('app boots', () => assert.ok(app));
EOF
printf '# linklite\n\nTiny URL shortener: POST /shorten, GET /:slug.\n' > README.md
git add -A && git -c user.email=demo@demo -c user.name=demo commit -qm "chore: project skeleton"

# --- 2. harden: project with an authored-but-naive plan ----------------------
rm -rf /tmp/afdemo-harden
mkdir -p /tmp/afdemo-harden
cd /tmp/afdemo-harden && git init -q
$CLI init --agent none > /dev/null
cat > .planning/REQUIREMENTS.md <<'EOF'
# Requirements

- **API-01**: POST /shorten returns a short link for a URL.
- **STORE-01**: Links persist to a JSON file across restarts.
EOF
cat > .agent-flow/plan.json <<'EOF'
{
  "schemaVersion": 1,
  "milestone": "v1",
  "createdAt": "2026-06-06T00:00:00.000Z",
  "cursor": { "phase": "1", "task": "1.1" },
  "phases": [
    {
      "id": "1", "title": "URL shortener API",
      "goal": "Shorten and persist links.",
      "requirements": ["API-01", "STORE-01"],
      "dependsOn": [], "status": "pending",
      "tasks": [
        {
          "id": "1.1", "title": "HTTP endpoint POST /shorten",
          "scope": ["src/server.js"], "wave": 1, "dependsOn": [],
          "status": "pending", "gates": ["test"],
          "acceptance": [
            { "id": "A1", "text": "POST /shorten returns 201 with the slug", "proof": "test" }
          ]
        },
        {
          "id": "1.2", "title": "File-backed JSON store",
          "scope": ["src/store.js"], "wave": 1, "dependsOn": [],
          "status": "pending", "gates": ["test"],
          "acceptance": [
            { "id": "A1", "text": "links persist to disk and reload", "proof": "test" }
          ]
        }
      ]
    }
  ]
}
EOF
# Pre-baked hardener verdict (what the one-agent pass returns).
cat > /tmp/afdemo-harden/hardener-output.txt <<'EOF'
Reviewed the plan for table-stakes gaps in its domains.

{"additions":[{"task":"1.1","text":"Request bodies are size-capped; oversized payloads get 413","proof":"test"},{"task":"1.1","text":"URLs restricted to http/https after parsing; javascript:/data: rejected with 400","proof":"test"},{"task":"1.1","text":"Slugs use crypto-grade randomness (crypto.randomBytes), never Math.random","proof":"test"},{"task":"1.2","text":"Writes are atomic (write-to-temp then rename) so a crash cannot corrupt the store","proof":"test"},{"task":"1.2","text":"Concurrent writes are serialized so none are lost","proof":"test"},{"task":"1.2","text":"A missing data file on first boot yields an empty store instead of crashing","proof":"test"},{"task":"1.2","text":"Slug creation delegates to crypto-grade randomness (crypto.randomBytes)","proof":"test"}],"notes":"7 table-stakes criteria the plan was missing"}
EOF

# --- 3. daily loop: project mid-execution ------------------------------------
# The skeleton (plan, tests, config) is committed. The executor's first attempt
# at src/slug.js is in the working tree, uncommitted — and it uses Math.random,
# so the gate is red for real. Its fix waits in /tmp/afdemo-loop-fix/.
rm -rf /tmp/afdemo-loop /tmp/afdemo-loop-fix
mkdir -p /tmp/afdemo-loop/src /tmp/afdemo-loop/test /tmp/afdemo-loop-fix
cd /tmp/afdemo-loop && git init -q
$CLI init --agent none > /dev/null
cat > package.json <<'EOF'
{
  "name": "linklite",
  "version": "0.1.0",
  "type": "module",
  "scripts": { "test": "node --test 'test/**/*.test.js'" }
}
EOF
cat > .planning/REQUIREMENTS.md <<'EOF'
# Requirements

- **SLUG-01**: Generate 6-char base62 slugs with crypto-grade randomness.
EOF
cat > test/slug.test.js <<'EOF'
import test from 'node:test';
import assert from 'node:assert/strict';
import { newSlug } from '../src/slug.js';

test('newSlug returns 6-char base62 strings', () => {
  for (let i = 0; i < 200; i += 1) assert.match(newSlug(), /^[0-9A-Za-z]{6}$/);
});

test('newSlug uses crypto, not Math.random', async () => {
  const src = await import('node:fs').then((fs) => fs.readFileSync('src/slug.js', 'utf8'));
  assert.ok(!src.includes('Math.random'));
  assert.ok(src.includes('node:crypto'));
});
EOF
cat > .agent-flow/plan.json <<'EOF'
{
  "schemaVersion": 1,
  "milestone": "v1",
  "createdAt": "2026-06-06T00:00:00.000Z",
  "cursor": { "phase": "1", "task": "1.1" },
  "phases": [
    {
      "id": "1", "title": "Slug generator",
      "goal": "Crypto-grade slug generation, unit tested.",
      "requirements": ["SLUG-01"],
      "dependsOn": [], "status": "active",
      "tasks": [
        {
          "id": "1.1", "title": "newSlug(): 6-char base62, crypto randomness",
          "scope": ["src/slug.js", "test/slug.test.js"], "wave": 1, "dependsOn": [],
          "status": "active", "gates": ["test"],
          "acceptance": [
            { "id": "A1", "text": "newSlug() returns 6-char base62 strings", "proof": "test" },
            { "id": "H1", "text": "uses crypto-grade randomness, never Math.random", "proof": "test" }
          ]
        }
      ]
    }
  ]
}
EOF
node -e "
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync('.agent-flow/config.json', 'utf8'));
cfg.orchestration = { ...cfg.orchestration, gates: { test: 'npm run test' }, review: { tier: 1 } };
fs.writeFileSync('.agent-flow/config.json', JSON.stringify(cfg, null, 2));
"
git add -A && git -c user.email=demo@demo -c user.name=demo commit -qm "chore(slug): plan, tests and config for task 1.1"
# The executor's first attempt: right shape, wrong randomness.
cat > src/slug.js <<'EOF'
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function newSlug() {
  let slug = '';
  for (let i = 0; i < 6; i += 1) slug += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return slug;
}
EOF
# The executor's fix after the red gate.
cat > /tmp/afdemo-loop-fix/slug.js <<'EOF'
import { randomInt } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function newSlug() {
  let slug = '';
  for (let i = 0; i < 6; i += 1) slug += ALPHABET[randomInt(ALPHABET.length)];
  return slug;
}
EOF
# Pre-baked independent reviewer verdict.
cat > /tmp/afdemo-loop/reviewer-verdict.txt <<'EOF'
Read src/slug.js and test/slug.test.js. Both criteria are genuinely satisfied: randomInt over a 62-char alphabet, 6 chars, no Math.random anywhere, tests exercise format and source. No scope creep.

{"verdict":"pass","notes":"Both acceptance criteria verified against the code; tests are genuine","findings":[]}
EOF

echo "demo fixtures ready"

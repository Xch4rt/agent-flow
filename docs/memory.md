# Memory & Context Packs

Agent Flow stores memory in plain files inside the repository. Nothing leaves your machine.

## Layout

| Where | What |
|---|---|
| `.planning/` | `PROJECT.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md`, `DECISIONS.md`, `OPEN_QUESTIONS.md` |
| `.memory/` | Append-only JSONL: `events.jsonl`, `decisions.jsonl`, `errors.jsonl`, `modules.jsonl` |
| `.agent-flow/memory.db` | Internal generated SQLite query index (never the source of truth) |

Every JSONL entry has `createdAt`, `type`, `summary`, plus structured fields per file:

- `events`: optional `module`, `files`, `tags`
- `modules`: required `module`, optional `files`, `tags`
- `decisions`: optional `module`, `status`, `rationale`, `alternatives`
- `errors`: optional `module`, `cause`, `solution`

## Appending memory

Entries are validated per target file; exact duplicates are rejected by default (use `--allow-duplicate` only when repeating is intentional):

```sh
agent-flow memory append --file events --type change --summary "Documented initial architecture" --module api --files src/api.ts --tags architecture
agent-flow memory append --file decisions --type decision --summary "Keep memory local JSONL" --status accepted --rationale "Simple, reviewable, repo-local"
agent-flow memory append --file errors --type error --summary "Build failed on missing env validation" --cause "Required env var unchecked" --solution "Validate env at startup"
```

## Querying

Search stays local and non-semantic:

```sh
agent-flow memory search "billing"          # raw JSONL lookup
agent-flow memory query "billing webhook"   # indexed structured lookup
agent-flow context "fix billing webhook"    # full project-aware context pack
```

## Context packs

`agent-flow context "<task>"` turns planning files, structured memory, and detected project commands into a compact task-focused brief — instead of pasting all of `.planning/` and `.memory/`. Scoring is deterministic and local: keyword matching, exact-phrase boosts, module preference, type priority, status, recency. No embeddings, no MCP, no external services.

Example (abridged):

```text
# Context Pack

Task: fix billing webhook

Project Summary:
- Stack: Next.js, Prisma — Commands: test=pnpm test, typecheck=pnpm typecheck

Relevant Modules:
- [billing] Billing module owns checkout, invoices, and webhook idempotency.

Relevant Errors:
- Duplicate Stripe webhook processing created duplicate credits.
  cause: Missing event id guard. solution: Store processed event ids first.

Verification Commands:
- pnpm test
```

Useful flags: `--module billing` to prefer one area, `--budget-lines 60` for a tighter paste, `--json` for structured output, `--stats` for token-savings numbers.

## The SQLite index

JSONL is the reviewable source of truth; `.agent-flow/memory.db` is a generated index, auto-created and synced when query-producing commands need it.

- `agent-flow memory inspect` — index health and counts (read-only)
- `agent-flow memory rebuild` — recreate only the generated index; never touches `.memory/*.jsonl`
- `agent-flow memory validate` — find exact file/line errors in JSONL entries

## Onboarding & safety notes

- `agent-flow onboard` writes the deterministic baseline; the `flow-onboard` skill adds agent judgment on top.
- For `onboard`, `--force` replaces generated sections only — it does not wipe custom content outside markers and does not wipe memory. `--refresh` appends a new onboarding event without duplicating module entries.
- For `init`, existing files are protected; `--force` never overwrites memory files — that requires an explicit `--force-memory`.
- Old or manually edited memory entries may fail validation if they miss required fields; fix them manually or re-add via `memory append`.

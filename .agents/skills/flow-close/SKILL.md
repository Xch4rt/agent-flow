---
name: flow-close
description: Close a session by updating state and appending useful memory entries for future resumes. Use at the end of meaningful work.
---

# flow-close

Use at the end of meaningful work. The goal is continuity, not a diary.

Useful durable memory improves future indexed `agent-flow context "<task>"` packs. Keep it concise and non-duplicated.

Update:

- `.planning/STATE.md`: rewrite the current status, changed areas, verification result and next actions (keep it short; it is read at every resume — do not let it grow).
- `.planning/DECISIONS.md`: durable decisions only.
- `.planning/OPEN_QUESTIONS.md`: unresolved questions that affect future work.

Append JSONL entries when useful:

- `.memory/events.jsonl`: completed work, important context, verification outcome.
- `.memory/decisions.jsonl`: decisions with rationale and consequence.
- `.memory/errors.jsonl`: errors, root cause, fix, and prevention.
- `.memory/modules.jsonl`: module purpose, important files, constraints.

Prefer the CLI append helper when available:

```sh
agent-flow memory append --file events --type change --summary "Added deterministic memory validation for CLI append" --module memory --files src/core/jsonl-memory.ts --tags validation,cli
agent-flow memory append --file modules --type module --summary "Memory commands own append, search, and context output" --module memory --files src/commands/memory.ts --tags cli
agent-flow memory append --file decisions --type decision --summary "Keep memory local and schema-validated without semantic search" --status accepted --rationale "v0.3.0 scope is memory quality only"
agent-flow memory append --file errors --type error --summary "Memory append rejected invalid module entries" --module memory --cause "modules require module" --solution "include --module for modules entries"
```

Supported `--file` values are `events`, `decisions`, `errors`, and `modules`. Edit JSONL manually only if the CLI command is unavailable.

JSONL entry shape:

```json
{"createdAt":"2026-01-01T00:00:00.000Z","type":"event","summary":"Short durable note","files":["src/example.ts"],"tags":["area"]}
```

Rules:

- Keep entries short and factual.
- Avoid vague entries like "updated files" or "fixed bug"; name the durable fact future sessions need.
- Do not duplicate every final response or append exact duplicates.
- Record decisions only when a real durable choice was made.
- Record errors only when both cause and solution are known.
- Do not record secrets.
- Mark uncertainty explicitly.
- Prefer one useful memory entry over many noisy entries.

Final output:

- Files updated.
- Memory entries appended.
- Recommended next commands: exact commands or skill invocations to continue.

Always end with:

- Recommended next commands: exact copy-pasteable commands or Codex skill invocations, ordered by what the user should do next. Include only commands that are useful for the current state.

For closeout, usually recommend:

1. `git status --short`
2. The relevant commit command if the work is ready
3. `$flow-resume` for the next session

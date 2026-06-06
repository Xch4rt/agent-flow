# Changelog

## v0.7.0

Orchestration rigor: tiered review loop, domain hardening, and a real smoke gate — validated by an E2E benchmark (same project built three ways).

### Orchestration (Tier 0–2)

- Added the structured orchestration plan (`.agent-flow/plan.json`) with phases, tasks, waves, dependencies, gates, and acceptance criteria; `plan init` (with `--scaffold` from REQUIREMENTS.md ids), `plan validate`, `plan show`, and `plan render` (generated ROADMAP.md view).
- Added the Tier-0 conductor loop: `next` (scoped context-pack envelopes), `gate` (cached, keyed to a worktree content signature), and `advance` (hard gate — refuses unless gates are green for the current code).
- Added Tier-1 independent phase review: `review emit --phase N` builds a reviewer briefing; `advance` refuses to close a phase without a passing verdict for the exact current code.
- Added Tier-2 wave fan-out: `next --wave` emits one envelope per parallelizable, scope-disjoint task so the host runtime can run executors concurrently.
- Added the built-in smoke gate: boots the app via the configured start command and probes it over real HTTP.
- Added `--root <dir>` global flag (and `AGENT_FLOW_ROOT`) with upward project discovery, so every command can target a project from anywhere.

### Reviewer adapter

- Added `review emit --reviewer` — prints a self-contained, spawn-ready prompt for an independent reviewer agent (goal, acceptance criteria, scope files, rubric, strict-JSON output contract).
- Added `review record --from-json <file|->` — ingests a reviewer JSON verdict from a file or stdin, tolerating prose around the JSON; merges notes and findings into the review record. `--verdict` is now optional.

### Domain hardening

- Added pitfall packs: curated zero-token checklists (`http-api`, `persistence`, `auth-secrets`, `randomness`) matched per task by scope/gates/keywords; `plan validate` warns about table-stakes acceptance criteria a task is missing, waivable per criterion or per pack via the new `waives` task field.
- Added hardening expectations to the Tier-1 review envelope, and a rubric rule making missing table-stakes hardening a blocking finding unless waived.
- Added `plan harden`: emits a spawn-ready prompt for a single domain-hardening reviewer agent; `plan harden --apply --from-json -` merges its proposed acceptance criteria into plan.json with fresh `H<n>` ids.

### Fixes

- Smoke probes now send `body` and `headers` (content-type defaults to `application/json` when a body is set) — POST probes with a payload previously hit the server with an empty body.

## v0.5.3

Dashboard CLI.

- Added an interactive blessed-powered dashboard when running `agent-flow` without a subcommand.
- Added Bolt and Luna terminal mascots for execution and memory modes.
- Added dashboard panels for project state, menu navigation, execution mode, memory mode, and system guidance.
- Added non-interactive terminal fallback output for CI and piped environments.
- Kept existing public commands and memory behavior unchanged.

## v0.5.0

Internal SQLite memory index.

- Added `.agent-flow/memory.db` as an internal generated SQLite index while keeping `.memory/*.jsonl` as the reviewable source of truth.
- Added `agent-flow memory query <query>` for deterministic indexed memory lookup.
- Added `agent-flow memory inspect` and `agent-flow memory rebuild` for high-level index health and regeneration.
- Updated `agent-flow context <task>` to prefer indexed memory with JSONL fallback.
- Updated `agent-flow status` and `agent-flow doctor` with memory index awareness.
- Updated generated Codex skills and `AGENTS.md` to describe indexed context packs without exposing low-level database management.

## v0.4.0

Deterministic project-aware context packs.

- Added `agent-flow context <task>` with `--module`, `--limit`, `--budget-lines`, `--json`, `--include-events`, `--include-open-questions`, and `--no-color`.
- Added deterministic local relevance scoring across planning and JSONL memory, without embeddings, SQLite, MCP, or external services.
- Added compact text and stable JSON output for task-focused agent handoff.
- Added project summary and lightweight git context to context packs.
- Suppressed superseded, deprecated, obsolete, and rejected decisions by default when active relevant decisions exist.
- Updated generated Codex skills and `AGENTS.md` to prefer focused context packs before non-trivial agent work.
- Updated documentation to clarify `memory search`, `memory context`, and project context pack usage.
- Updated `agent-flow status` with a quiet context-pack memory signal.

## v0.3.0

Structured memory quality improvements.

- Added Zod schemas for events, modules, decisions, and errors memory files.
- Added memory append validation by target file.
- Added `agent-flow memory validate` with file, line, field, raw preview, and suggested fixes.
- Added duplicate prevention for exact memory entries, with `--allow-duplicate` escape hatch.
- Added `agent-flow memory search` filters: `--file`, `--type`, `--module`, and `--limit`.
- Added `agent-flow memory context <query>` for compact deterministic context packs.
- Updated `agent-flow status` to report invalid memory entry counts.
- Updated `agent-flow doctor` to validate memory schemas and surface detailed diagnostics.
- Updated `flow-close` and `flow-resume` Codex skills for higher-quality memory usage.

## v0.2.0

Deterministic repository onboarding.

- Added `agent-flow onboard`.
- Added generated onboarding sections with `agent-flow:onboard` markers.
- Added onboarding health to `agent-flow status`.
- Added onboarding checks to `agent-flow doctor`.
- Updated Codex skills to prefer deterministic onboarding before agent-guided enrichment.
- Added safe onboarding behavior: `--dry-run`, `--refresh`, generated-section replacement, and custom content preservation.
- Avoided duplicate module memory entries during onboarding refresh.

## v0.1.0

Initial Codex-first MVP.

- Added `agent-flow init --codex`.
- Added `agent-flow status`.
- Added `agent-flow doctor`.
- Added `agent-flow memory list`, `memory search`, and `memory append`.
- Added six Codex skills: `flow-onboard`, `flow-resume`, `flow-quick`, `flow-plan`, `flow-verify`, and `flow-close`.
- Added file-based planning and memory using `.planning/` and `.memory/`.
- Added safe file generation with memory protection unless `--force-memory` is explicitly used.

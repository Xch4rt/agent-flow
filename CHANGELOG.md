# Changelog

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

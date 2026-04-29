# Changelog

## v0.1.0

Initial Codex-first MVP.

- Added `agent-flow init --codex`.
- Added `agent-flow status`.
- Added `agent-flow doctor`.
- Added `agent-flow memory list`, `memory search`, and `memory append`.
- Added six Codex skills: `flow-onboard`, `flow-resume`, `flow-quick`, `flow-plan`, `flow-verify`, and `flow-close`.
- Added file-based planning and memory using `.planning/` and `.memory/`.
- Added safe file generation with memory protection unless `--force-memory` is explicitly used.

# Roadmap

> Generated from `.agent-flow/plan.json` by `agent-flow plan render`. Edit the plan, not this file.

**Milestone:** v0.11 — evidence and tuning
**Progress:** 7/15 tasks (47%), 3/6 phases

## Phase 1: Dogfood: agent-flow runs on itself — done
**Goal:** The repo is planned, remembered and gated with its own loop; the first friction found is fixed.
**Requirements:** DOG-01, DOG-02

- [x] 1.1 (wave 1) Commit the agent-flow setup for this repo — done
  - A1 [manual]: agent-flow doctor and doctor --tokens are green for this repo
  - A2 [manual]: REQUIREMENTS.md carries the v0.11 ids and plan validate has no warnings
  - A3 [manual]: Friction found during setup is recorded in .memory/events.jsonl (tag dogfood)
  - A4 [manual]: .claude/settings.local.json is ignored and not committed
- [x] 1.2 (wave 2) init: honest .gitignore label and ignore Claude Code local settings — done
  - A1 [test]: ensureGitignore reports 'appended' (new status) when it only adds entries, 'skipped' when none are missing; never 'overwritten'
  - A2 [test]: init --claude adds .claude/settings.local.json to .gitignore alongside the scratch entries
  - A3 [test]: doctor --tokens '.gitignore covers agent-flow scratch' check accepts the new entry set

## Phase 2: Project detection beyond five frameworks — done
**Goal:** onboard, AGENTS.md and context packs describe plain Node/TS, Python, Go, Rust and monorepo projects correctly.
**Requirements:** DETECT-01, DETECT-02, DETECT-03
**Depends on:** 1

- [x] 2.1 (wave 1) Detect plain Node/TypeScript projects, test runners, lint and typecheck — done
  - A1 [test]: A package.json without a known framework yields stack 'Node' (plus 'TypeScript' when tsconfig.json or typescript dep exists), never 'none'
  - A2 [test]: Test runner is detected from devDependencies or the test script: vitest, jest, node:test, mocha
  - A3 [test]: lint and typecheck commands are detected from scripts (lint, eslint, typecheck, type-check, tsc) and from eslint/tsconfig presence when no script exists
  - A4 [test]: Package manager falls back to packageManager field in package.json, then to npm when package.json exists without a lockfile
  - A5 [manual]: This repo onboarded reports pnpm, Node + TypeScript, vitest, typecheck
- [x] 2.2 (wave 2) Detect Python, Go and Rust projects with their commands — done
  - A1 [test]: pyproject.toml / requirements.txt yields stack Python with test (pytest), lint (ruff/flake8 when configured) and the detected package manager (uv, poetry, pip)
  - A2 [test]: go.mod yields stack Go with go test ./..., go vet ./..., go build ./...
  - A3 [test]: Cargo.toml yields stack Rust with cargo test, cargo clippy, cargo build
  - A4 [test]: Gate resolution uses the detected commands when config has none for a gate name
- [x] 2.3 (wave 3) List monorepo workspaces as packages with their own commands — done
  - A1 [test]: pnpm-workspace.yaml, package.json workspaces and turbo.json are recognized; each package is listed with name, path and its own test/build/lint/typecheck commands
  - A2 [test]: PROJECT.md and AGENTS.md generated sections include a Workspaces table when packages exist
  - A3 [test]: A context pack for a task whose scope lies inside one package names that package and its commands first
  - A4 [test]: The detected test runner (vitest / jest / node:test / mocha) is printed by status and onboard and written to PROJECT.md and AGENTS.md generated sections

## Phase 2b: Beyond Node: compact output and onboarding for Go, Rust and Python — done
**Goal:** A Go, Rust or Python team gets the same token savings and onboarding quality as a Node team.
**Requirements:** DETECT-04, DETECT-05
**Depends on:** 2

- [x] 2b.1 (wave 1) Compact output parsers for go test, cargo test, ruff and clippy/rustc — done
  - A1 [test]: go test (plain and -v) output yields one failure per failing test with file:line and message from the '--- FAIL: Name' block and its 'file_test.go:12: msg' lines; summary counts passed/failed packages or tests
  - A2 [test]: cargo test output yields one failure per 'test name ... FAILED' with the 'panicked at src/file.rs:10:5' location and message; summary from the 'test result:' line
  - A3 [test]: ruff check output ('path:line:col: CODE message') yields one failure per line with file:line and 'CODE message'; summary with the count
  - A4 [test]: cargo clippy / rustc diagnostics ('error[E0308]: msg' followed by '--> src/file.rs:3:5') yield one failure per error with file:line; warnings are counted in the summary but not listed as failures
  - A5 [test]: ToolKind gains 'go-test', 'cargo-test', 'ruff', 'rustc'; parser order keeps existing tools' tests green and the generic tail fallback unchanged
- [x] 2b.2 (wave 1) Onboarding important files for Go, Rust, Python; language-neutral pack wording — done
  - A1 [test]: go.mod, go.sum, Cargo.toml, Cargo.lock, uv.lock, poetry.lock, Pipfile, setup.py, setup.cfg and Makefile are important-file candidates; cmd, internal, pkg, crates and tests are important-directory candidates
  - A2 [test]: A Go fixture (go.mod + cmd/ + internal/) onboards with go.mod and cmd listed as important and no 'Package manager not detected' risk; a Rust fixture likewise with Cargo.toml
  - A3 [test]: The randomness pack criterion names the property (CSPRNG) with examples for Node, Python, Go and Rust instead of only crypto.randomBytes / Math.random; existing harden tests still match by criterion id

## Phase 2c: Loop fixes found by dogfooding — pending
**Goal:** Wave fan-out and the generated .gitignore work as documented.
**Requirements:** DOG-03
**Depends on:** 2b

- [ ] 2c.1 (wave 1) Gate cache keyed per task so a wave can be gated before it is advanced — pending
  - A1 [test]: .agent-flow/gate-cache.json stores one record per task id; gating task B no longer discards task A's green result
  - A2 [test]: advance still refuses when the task's own cached signature does not match the current worktree
  - A3 [test]: A legacy single-record cache file is read as a one-entry map (no crash, no stale pass)
  - A4 [test]: Integration: gate A, gate B, advance A, advance B succeeds for two scope-disjoint tasks in one wave
- [ ] 2c.2 (wave 1) init ignores every SQLite side file of the memory index — pending
  - A1 [test]: GITIGNORE_ENTRIES ignores .agent-flow/memory.db-shm and .agent-flow/memory.db-wal (or a pattern covering them) and missingGitignoreEntries treats a .gitignore that already has only memory.db as missing them

## Phase 3: Router feedback from observed usage — pending
**Goal:** Judge the router from what tasks actually cost and how often they passed first time; suggest, never apply.
**Requirements:** ROUTER-01, ROUTER-02
**Depends on:** 1

- [ ] 3.1 (wave 1) agent-flow router report: per-tier outcomes from task-stats and usage — pending
  - A1 [test]: task-stats.json records, per task, the tier and rung assigned at each gate run (not only counts), so outcomes can be grouped by tier
  - A2 [test]: router report prints, per tier: tasks routed, first-attempt green rate, escalations, median tokens per task (from usage subagent data when available, 'n/a' otherwise)
  - A3 [test]: --json emits the same data; --all aggregates every project usage can see
  - A4 [test]: A project with no gate history prints a clear 'no routed tasks yet' line and exits 0
- [ ] 3.2 (wave 2) Verdict and threshold suggestion in the router report — pending
  - A1 [test]: Report flags 'optimistic' when more than a third of light/standard tasks escalated, 'pessimistic' when more than two thirds of deep tasks passed on the first attempt, 'balanced' otherwise; thresholds are documented
  - A2 [test]: The suggestion is a concrete config change (orchestration.router.thresholds values) printed as text; the command never writes config.json
  - A3 [test]: Verdicts need at least five routed tasks; below that the report says the sample is too small

## Phase 4: Published benchmark — pending
**Goal:** The 24% claim becomes a reproducible table across three tasks, three workflows and both runtimes.
**Requirements:** BENCH-01, BENCH-02
**Depends on:** 2, 3, 2b, 2c

- [ ] 4.1 (wave 1) Bench task: HTTP API + persistence (linklite) — pending
  - A1 [manual]: Seed repo with package.json and a failing-by-absence feature; task.md asks for POST /shorten and GET /:slug persisted to a JSON file
  - A2 [manual]: Hidden tests cover the happy path and the table-stakes criteria: body cap, scheme allowlist, atomic write, concurrent writes serialized, a missing data file on first boot yields an empty store, crypto-grade slugs
  - A3 [test]: test/bench-tasks.test.ts validates every bench/tasks/* folder: bench.json parses, check command present, seed/ and hidden/ exist
- [ ] 4.2 (wave 1) Bench task: CLI tool (csv-stats) — pending
  - A1 [manual]: task.md asks for a CLI that reads CSV from a file or stdin and prints per-column count/min/max/mean with --json; hidden tests exercise malformed rows, empty input, exit codes
  - A2 [manual]: bench.json check runs the hidden tests with node --test
- [ ] 4.3 (wave 1) Bench task: refactor existing code without changing behaviour — pending
  - A1 [manual]: Seed contains a working but tangled order-pricing module with its own passing tests; task.md asks to split it into pure functions and add discount rules
  - A2 [manual]: Hidden tests pin existing behaviour (golden outputs) and verify the new rules
- [ ] 4.4 (wave 2) Run the matrix and publish docs/bench-results.md — pending
  - A1 [manual]: Three runs per task × variant (plain, gsd, agent-flow) × runtime (claude, codex); bench report --out docs/bench-results.md
  - A2 [manual]: docs/bench-results.md states models, agent-flow version, dates and the exact commands; README links it and replaces the single-e2e 24% sentence with the table's numbers

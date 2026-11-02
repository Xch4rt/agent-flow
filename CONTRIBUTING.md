# Contributing

Thanks for looking at agent-flow. Issues and pull requests are welcome; this page is the whole process.

## Setup

```sh
git clone https://github.com/Xch4rt/agent-flow.git
cd agent-flow
pnpm install          # pnpm 10 (see packageManager in package.json), Node >= 20
pnpm build            # dist/ — the CLI runs from here
pnpm test             # vitest
pnpm typecheck
```

`pnpm dev -- <args>` runs the CLI from `src/` without building. To try your build as the global `agent-flow`, use `npm link` or run `node dist/cli.js`.

## How the repo works

- `main` is protected: changes land through pull requests, and the `ci` check (typecheck, build, tests on Node 20/22/24, a CLI smoke run) must be green. Nobody pushes to `main` directly, including maintainers.
- This repo uses agent-flow on itself. `.agent-flow/plan.json` holds the current milestone; `agent-flow plan show` prints it. If your change fits a planned task, say so in the PR. If not, that is fine too: small fixes do not need a plan entry.
- Gates are the gates: a PR that weakens a test to go green will not be merged. Fix the code or explain why the test was wrong.

## Making a change

1. Open an issue first for anything bigger than a bug fix or a doc tweak, so the shape can be agreed before the work.
2. Branch from `main` (`feat/...`, `fix/...`, `docs/...`).
3. Add or update tests next to the code: `test/<area>.test.ts`. New behaviour needs a test; a fixed bug needs a regression test.
4. If a command, flag or generated file changes, update `docs/commands.md` and, when user-facing, the README.
5. Commit messages follow `type(scope): summary` (`feat(detect): ...`, `fix(gates): ...`, `docs: ...`). Keep the body to what a reader of `git log` needs.
6. Open the PR with the template filled in. CI runs on every push to the PR.

## Where things live

| Area | Code | Tests |
| --- | --- | --- |
| CLI entry and commands | `src/cli.ts`, `src/commands/` | `test/cli.test.ts`, per command |
| Plan, gates, review, router | `src/core/plan*.ts`, `gates.ts`, `review.ts`, `router.ts`, `models.ts` | `test/orchestration.test.ts`, `plan.test.ts`, `review.test.ts`, `models.test.ts` |
| Project detection and onboarding | `src/core/detect-project.ts`, `onboard.ts`, `templates.ts` | `test/detect-project.test.ts`, `onboard.test.ts` |
| Memory and context packs | `src/core/jsonl-memory.ts`, `memory-index.ts`, `context-pack.ts` | `test/jsonl-memory.test.ts`, `memory-index.test.ts`, `context.test.ts` |
| Claude Code / Codex adapters (skills, agents, hooks) | `src/adapters/`, `src/core/claude-settings.ts`, `codex-settings.ts` | `test/claude-adapter.test.ts`, `codex-*.test.ts` |
| Token tools: usage, guard, compact output, bench | `src/core/claude-usage.ts`, `codex-usage.ts`, `guard.ts`, `compact-output.ts`, `bench.ts` | matching `test/*.test.ts` |
| Pitfall packs | `src/core/packs.ts` | `test/harden.test.ts` |
| Demos | `demo/` (VHS tapes, fixtures) | rendered outputs in `demo/out/` |

## Good first contributions

- A pitfall pack for a domain you know (`src/core/packs.ts`): a few table-stakes criteria with keywords and `satisfiedBy` hints.
- A compact-output parser for a test runner or linter you use (`src/core/compact-output.ts`), with a real output sample in the test.
- Project detection for a stack that still reports `none` (`src/core/detect-project.ts`).
- A bench task in `bench/tasks/` (see its README): seed repo, task prompt, hidden tests.

## Releases

Maintainers cut releases: version bump, `CHANGELOG.md`, tag, GitHub release, `npm publish`. Contributors do not need to touch any of that.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Security issues go through [SECURITY.md](SECURITY.md), never a public issue.

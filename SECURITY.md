# Security

## Reporting a vulnerability

Please report security issues privately through GitHub's
[private vulnerability reporting](https://github.com/Xch4rt/agent-flow/security/advisories/new)
for this repository. Do not open a public issue.

You should get an acknowledgement within a few days. Once a fix is ready it ships as a patch
release on npm with a note in `CHANGELOG.md`; credit goes to the reporter unless they prefer otherwise.

## Scope

agent-flow is a local CLI: it reads and writes files inside your repository, runs the gate commands
you configure, reads Claude Code transcripts and Codex rollouts on your machine, and never talks to
a network service of its own. Things we consider in scope:

- Command injection through plan, config or generated files (gate commands, workspace names, smoke probes).
- Paths escaping the project root (context packs, workspaces, onboarding).
- Hooks (`agent-flow guard`) misreading hook input in a way that blocks or unblocks tool calls incorrectly.
- Anything that would make `agent-flow usage` or `bench` leak transcript contents.

## Supported versions

The latest minor release on npm receives fixes. Older 0.x releases do not.

# Release Checklist

## v0.2.0

Run the release checks:

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm pack
```

Validate deterministic onboarding:

```sh
agent-flow init --codex
agent-flow status
agent-flow doctor
agent-flow onboard --dry-run
agent-flow onboard
agent-flow status
agent-flow doctor
```

Test install from the tarball:

```sh
npm install -g ./agent-flow-0.2.0.tgz
agent-flow --help
agent-flow init --help
agent-flow onboard --help
agent-flow status --help
agent-flow doctor --help
agent-flow memory --help
```

Tag the release:

```sh
git tag v0.2.0
git push origin v0.2.0
```

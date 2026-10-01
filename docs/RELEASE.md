# Release Checklist

## Any release (current: v0.9.0)

```sh
pnpm install --frozen-lockfile
pnpm test && pnpm typecheck && pnpm build
npm pack --dry-run                     # only dist/, README.md, LICENSE, CHANGELOG.md, package.json
npm pack && npm install -g ./xch4rt-agent-flow-<version>.tgz
agent-flow --version && agent-flow doctor --tokens && agent-flow run -- node -e "console.log(1)"
npm publish --access public            # needs npm login (and an OTP with 2FA)
git tag v<version> && git push origin v<version>
```

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

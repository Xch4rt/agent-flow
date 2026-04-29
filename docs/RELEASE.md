# Release Checklist

## v0.1.0

Run the release checks:

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm pack
```

Test install from the tarball:

```sh
npm install -g ./agent-flow-0.1.0.tgz
agent-flow --help
agent-flow init --help
agent-flow status --help
agent-flow doctor --help
agent-flow memory --help
```

Tag the release:

```sh
git tag v0.1.0
git push origin v0.1.0
```

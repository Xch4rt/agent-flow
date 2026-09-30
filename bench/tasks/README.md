# Bench tasks

Each folder is one task for `agent-flow bench`:

- `bench.json` — `check` (command that must pass), optional `setup`.
- `task.md` — the prompt you give the agent.
- `seed/` — the starting repo.
- `hidden/` — acceptance tests copied in only at `bench finish`; the agent never sees them.

```sh
agent-flow bench prepare bench/tasks/slugify --variant af-next
# cd into the printed workspace, run the variant's workflow with the same model
agent-flow bench finish ~/.agent-flow-bench/slugify/<run-id>
agent-flow bench report
```

Run every variant (for example `plain`, `gsd`, `af-0.8`, `af-next`) several times per task; the report shows medians.

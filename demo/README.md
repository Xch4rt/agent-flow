# Demos

Reproducible terminal recordings for agent-flow, rendered with [VHS](https://github.com/charmbracelet/vhs). No screen capture: each video is generated deterministically from a `.tape` script, so they stay accurate as the CLI evolves.

## Rendering

```sh
brew install vhs              # one-time (brings ttyd + ffmpeg)
bash demo/setup-demo.sh       # builds deterministic fixtures under /tmp
vhs demo/hero.tape            # → demo/out/hero.{gif,mp4}
vhs demo/quickstart.tape      # → demo/out/quickstart.{gif,mp4}
vhs demo/harden.tape
vhs demo/daily-loop.tape
```

Re-run `setup-demo.sh` before re-recording any tape — all three mutate their fixture state (that's the point: the gates are real). Fixtures live in `/tmp/afdemo-quickstart`, `/tmp/afdemo-harden`, `/tmp/afdemo-loop`, `/tmp/afdemo-hero` (plus `/tmp/afdemo-loop-fix`, the executor's fix the loop tape copies in after the red gate). The quickstart chooser answers `2` (Claude Code); the "Detected on this machine" line depends on the recording machine.

## The videos

| Tape | Story (≈60s each) |
|---|---|
| `hero.tape` | The 40-second cut for the README header and posts: a real red gate with `file:line`, the fix, `gate` green, `advance` closes, commit. Review tier 0 so nothing else gets in the way. |
| `quickstart.tape` | A small Express project, zero to validated plan: `init` (runtime chooser) → `onboard` → `doctor --tokens` → declare requirements → `plan init --scaffold` → `plan validate` → `plan show` with routed tiers. |
| `harden.tape` | A naive plan ships naive code. Pitfall packs flag the gaps for free; one hardening agent turns them into acceptance criteria; `validate` comes back clean and `plan show` routes both tasks to the deep tier. |
| `daily-loop.tape` | The hard gate at work: `next --brief` dispatches, the executor's first attempt fails the gate for real (`Math.random`), the fix lands, gates green, but `advance` refuses to close the phase without an independent review. Emit the reviewer prompt, record its JSON verdict, phase closes, commit after `advance`. |

## Voiceover scripts (for narrated versions)

**Hero, 40 s (ES):**
> "Tu agente dice que terminó. agent-flow no le cree: corre los gates de la tarea y falla de verdad, con archivo y línea. Llega el fix, el gate pasa, y `advance` cierra el trabajo solo porque está probado para el código tal como está ahora. The gates are the gates."

**Quickstart (ES):**
> "Esto es agent-flow. `init` pregunta qué runtime usas e instala skills, agentes con modelo explícito y el guard hook. `onboard` lee el repo y escribe la base de planning y memoria sin gastar un token. `doctor --tokens` revisa la higiene: instrucciones siempre cargadas, hooks, agentes. Declaras qué debe hacer tu proyecto con requirement IDs, el plan se siembra desde ahí, y `plan show` ya muestra a qué tier va cada tarea. De aquí, `/flow-orchestrate` ejecuta el loop."

**Hardening (ES):**
> "Un plan escrito sin conocimiento del dominio embarca código sin endurecer. Los pitfall packs de agent-flow detectan eso gratis: body caps, escrituras atómicas, cache headers, randomness criptográfica. Un solo agente convierte los gaps en acceptance criteria — doce mil tokens, no quinientos mil — y el router, al ver esos criterios, sube las tareas al tier profundo. Los gates los hacen cumplir. En un primer experimento, una tarea y una corrida, esto igualó el checklist de hardening de un pipeline de research completo con una cuarta parte de sus tokens; el benchmark reproducible viene en camino."

**Daily loop (ES):**
> "El orquestador pide la siguiente tarea y el router elige qué ejecutor la toma, sin gastar tokens. El ejecutor dice que terminó. ¿Le crees? agent-flow no: el gate falla de verdad, con archivo y línea, y dice quién reintenta. Llega el fix, el gate pasa, pero `advance` se niega a cerrar la fase sin el veredicto de un reviewer independiente que lee el código. Emites el prompt, el reviewer responde en JSON, lo registras, la fase cierra, y solo entonces haces commit. The gates are the gates."

## Conventions

- 1280×720, Catppuccin Mocha, FontSize 17 — consistent across tapes.
- Comments (`# ...`) typed on screen carry the narrative; keep them to one line.
- Every tape must end on a true statement: never record a take where the tool output contradicts the narration.

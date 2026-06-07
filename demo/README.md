# Demos

Reproducible terminal recordings for agent-flow, rendered with [VHS](https://github.com/charmbracelet/vhs). No screen capture: each video is generated deterministically from a `.tape` script, so they stay accurate as the CLI evolves.

## Rendering

```sh
brew install vhs              # one-time (brings ttyd + ffmpeg)
bash demo/setup-demo.sh       # builds deterministic fixtures under /tmp
vhs demo/quickstart.tape      # → demo/out/quickstart.{gif,mp4}
vhs demo/harden.tape
vhs demo/daily-loop.tape
```

Re-run `setup-demo.sh` before re-recording `daily-loop.tape` or `harden.tape` — those tapes mutate their fixture state (that's the point: the gates are real).

## The three videos

| Tape | Story (≈60s each) |
|---|---|
| `quickstart.tape` | Zero to validated plan: `init --claude` → declare requirements → `plan init --scaffold` → `plan validate`. |
| `harden.tape` | A naive plan ships naive code. Pitfall packs flag the gaps for free; one hardening agent turns them into acceptance criteria; `validate` comes back clean. |
| `daily-loop.tape` | The hard gate at work: gates green, but `advance` refuses to close the phase without an independent review. Emit the reviewer prompt, record its JSON verdict, phase closes. |

## Voiceover scripts (for narrated versions)

**Quickstart (ES):**
> "Esto es agent-flow. Un comando instala los skills de Claude Code y la estructura de planning. Declaras qué debe hacer tu proyecto con requirement IDs, y el plan se siembra solo desde ahí. `plan validate` revisa estructura, cobertura y hardening de dominio — todo determinista, cero tokens. De aquí, `/flow-orchestrate` ejecuta el loop."

**Hardening (ES):**
> "Un plan escrito sin conocimiento del dominio embarca código sin endurecer. Los pitfall packs de agent-flow detectan eso gratis: body caps, escrituras atómicas, cache headers, randomness criptográfica. Un solo agente convierte los gaps en acceptance criteria — doce mil tokens, no quinientos mil — y los gates los hacen cumplir. En nuestro benchmark, esto igualó la calidad de un pipeline de research completo al 24% de su costo."

**Daily loop (ES):**
> "Tu agente dice que terminó. ¿Le crees? agent-flow no. `advance` se niega a cerrar trabajo cuyos gates no estén verdes para el código exacto actual — y una fase no cierra sin el veredicto de un reviewer independiente que lee el código de verdad. Emites el prompt, el reviewer responde en JSON, lo registras, y solo entonces la fase cierra. The gates are the gates."

## Conventions

- 1280×720, Catppuccin Mocha, FontSize 17 — consistent across tapes.
- Comments (`# ...`) typed on screen carry the narrative; keep them to one line.
- Every tape must end on a true statement: never record a take where the tool output contradicts the narration.

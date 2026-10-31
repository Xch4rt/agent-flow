# agent-flow — the daily loop: dispatch → gate (red) → fix → gate → review → advance → commit.
# The hard gate refuses to close work that isn't proven.
# Render: vhs demo/daily-loop.tape   (run demo/setup-demo.sh first)

Output demo/out/daily-loop.gif
Output demo/out/daily-loop.mp4

Set FontSize 17
Set Width 1280
Set Height 720
Set Padding 18
Set Theme "Catppuccin Mocha"
Set TypingSpeed 30ms

Hide
Type "cd /tmp/afdemo-loop && clear"
Enter
Show

Type "# The thin orchestrator asks what to dispatch; a zero-token router picks the executor:"
Enter
Sleep 1.5s

Type "agent-flow next --brief"
Enter
Sleep 3.5s

Type "# The executor says task 1.1 is done. Gate it:"
Enter
Sleep 1s

Type "agent-flow gate --task 1.1"
Enter
Sleep 5s

Type "clear"
Enter

Type "# Red: file:line, the reason, and which executor retries. Fast-forward — its fix lands:"
Enter
Sleep 1.5s

Type "cp ../afdemo-loop-fix/slug.js src/slug.js && agent-flow gate --task 1.1"
Enter
Sleep 3.5s

Type "agent-flow advance --task 1.1"
Enter
Sleep 3.5s

Type "# Refused: this phase needs an INDEPENDENT review before it can close."
Enter
Sleep 2s

Type "agent-flow review emit --phase 1 --reviewer | head -6   # spawn-ready prompt"
Enter
Sleep 4s

Type "clear"
Enter

Type "# A separate reviewer agent reads the code and answers in JSON. Record it:"
Enter
Sleep 1.5s

Type "agent-flow review record --phase 1 --from-json reviewer-verdict.txt"
Enter
Sleep 3.5s

Type "agent-flow advance --task 1.1"
Enter
Sleep 3s

Type "# Commit AFTER advance — the gate result is keyed to the working tree:"
Enter
Type "git add src .agent-flow/plan.json .memory && git commit -qm 'feat(slug): newSlug() with crypto randomness' && git --no-pager log --oneline -1"
Enter
Sleep 2.5s

Type "# Gates green + independent pass + commit. The gates are the gates."
Enter
Sleep 4.5s

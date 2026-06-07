# agent-flow — the daily loop: next → gate → review → advance.
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

Type "# Your agent just implemented task 1.1. Can it close the work? Only if it's proven."
Enter
Sleep 2s

Type "agent-flow gate --task 1.1"
Enter
Sleep 5s

Type "clear"
Enter

Type "agent-flow advance --task 1.1"
Enter
Sleep 3.5s

Type "# Refused: this phase needs an INDEPENDENT review before it can close."
Enter
Sleep 2s

Type "agent-flow review emit --phase 1 --reviewer | head -8   # spawn-ready prompt"
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

Type "# Gates green + independent pass = phase closed. The gates are the gates."
Enter
Sleep 4s

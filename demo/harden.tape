# agent-flow — domain hardening: pitfall packs + one agent = table-stakes
# acceptance criteria, enforced by the gates.
# Render: vhs demo/harden.tape   (run demo/setup-demo.sh first)

Output demo/out/harden.gif
Output demo/out/harden.mp4

Set FontSize 17
Set Width 1280
Set Height 720
Set Padding 18
Set Theme "Catppuccin Mocha"
Set TypingSpeed 30ms

Hide
Type "cd /tmp/afdemo-harden && clear"
Enter
Show

Type "# A plan written without domain knowledge ships without hardening."
Enter
Type "# agent-flow's pitfall packs catch that — for free:"
Enter
Sleep 2s

Type "agent-flow plan validate"
Enter
Sleep 4.5s

Type "clear"
Enter

Type "# One hardening agent turns those gaps into acceptance criteria:"
Enter
Sleep 1.5s

Type "agent-flow plan harden | head -12   # the spawn-ready prompt for ONE agent"
Enter
Sleep 4s

Type "clear"
Enter

Type "# Pipe the agent's raw answer back (prose around the JSON is fine):"
Enter
Sleep 1.5s

Type "agent-flow plan harden --apply --from-json hardener-output.txt"
Enter
Sleep 4.5s

Type "agent-flow plan validate"
Enter
Sleep 3s

Type "# Hardened. Now the gates and the tier-1 review enforce every criterion."
Enter
Sleep 4s

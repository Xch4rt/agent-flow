# agent-flow — quickstart: zero to validated plan in 60 seconds.
# Render: vhs demo/quickstart.tape   (run demo/setup-demo.sh first)

Output demo/out/quickstart.gif
Output demo/out/quickstart.mp4

Set FontSize 17
Set Width 1280
Set Height 720
Set Padding 18
Set Theme "Catppuccin Mocha"
Set TypingSpeed 30ms

Hide
Type "cd /tmp/afdemo-quickstart && clear"
Enter
Show

Type "# agent-flow: plan → harden → orchestrate, with gates that don't lie."
Enter
Sleep 1.5s

Type "agent-flow init --claude"
Enter
Sleep 3.5s

Type "clear"
Enter

Type "# Declare what the project must do (REQ ids drive everything):"
Enter
Sleep 1s
Type "echo '- **API-01**: POST /shorten returns a short link.' > .planning/REQUIREMENTS.md"
Enter
Type "echo '- **STORE-01**: Links persist across restarts.' >> .planning/REQUIREMENTS.md"
Enter
Sleep 1s

Type "agent-flow plan init --scaffold"
Enter
Sleep 3s

Type "agent-flow plan validate"
Enter
Sleep 3s

Type "# Structurally valid. Refine the draft tasks, then /flow-orchestrate in Claude Code."
Enter
Sleep 4s

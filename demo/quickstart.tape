# agent-flow — quickstart: install → onboard → doctor → validated plan, in about a minute.
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

Type "# A small Express project. Give it planning, memory and gates:"
Enter
Sleep 1.5s

Type "agent-flow init"
Enter
Sleep 4s
Type "2"
Enter
Sleep 3.5s

Type "clear"
Enter

Type "# Deterministic onboarding: stack, commands, modules, risks → .planning/ and .memory/"
Enter
Sleep 1s
Type "agent-flow onboard"
Enter
Sleep 3.5s

Type "agent-flow doctor --tokens"
Enter
Sleep 4s

Type "clear"
Enter

Type "# Declare what the project must do (REQ ids seed the plan):"
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

Type "agent-flow plan validate && agent-flow plan show"
Enter
Sleep 4s

Type "# Valid, with each task routed to a model tier — zero tokens so far."
Enter
Type "# In Claude Code: /flow-plan refines the draft, /flow-harden, then /flow-orchestrate runs the loop."
Enter
Sleep 4.5s

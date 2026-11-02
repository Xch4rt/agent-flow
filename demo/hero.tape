# agent-flow — the 40-second cut: one task, a check that fails for real,
# the fix, the close. Render: vhs demo/hero.tape   (run demo/setup-demo.sh first)

Output demo/out/hero.gif
Output demo/out/hero.mp4

Set FontSize 17
Set Width 1280
Set Height 720
Set Padding 18
Set Theme "Catppuccin Mocha"
Set TypingSpeed 30ms

Hide
Type "cd /tmp/afdemo-hero && clear"
Enter
Show

Type "# Your agent says task 1.1 is done. Don't take its word for it:"
Enter
Sleep 1.5s

Type "agent-flow gate --task 1.1"
Enter
Sleep 4.5s

Type "# Red, with file:line and the reason. The fix lands; gate again:"
Enter
Sleep 1.5s

Type "cp ../afdemo-loop-fix/slug.js src/slug.js && agent-flow gate --task 1.1"
Enter
Sleep 3s

Type "agent-flow advance --task 1.1"
Enter
Sleep 3s

Type "# advance closes work only when its gates are green for the code as it is now."
Enter
Type "git add -A && git commit -qm 'feat(slug): newSlug() with crypto randomness' && echo committed"
Enter
Sleep 2s

Type "# The gates are the gates."
Enter
Sleep 4s

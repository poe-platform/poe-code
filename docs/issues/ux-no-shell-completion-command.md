---
severity: low-medium
impact: usability
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- completion => 'Unknown command: completion'; no completion command registered in src/cli/commands (no .command(\"completion\") match); duplicate of ux-completion-command-missing.md"
comment: "Duplicate of ux-completion-command-missing.md, which has the better evidence (it shows the specific invocations rejected); retire into it. Rated Low-Medium against that file's Medium; normalise. Its argument is the stronger one though and should survive: completion matters in proportion to surface size, and this CLI's flag surface is large."
---

# UX: No shell completion install command

## Summary

No poe-code completion (bash/zsh/fish) command to install tab completion, despite a large command surface with many flags.

## Evidence

completion → command not found

## Why it matters

Discoverability of long flag sets suffers without completion.

## Suggested direction

Ship completion generators for bash/zsh/fish; document in help.

## Severity

Low–Medium

## Area

Help / completion

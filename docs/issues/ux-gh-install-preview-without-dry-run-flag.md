---
severity: medium
impact: usability
reproduced: y
recommendation: fix
evidence: "npm run dev -- github-workflows install --help lists only '[name]' and '--eject'; dryRun param declared at packages/github-workflows/src/commands.ts:278 with global:true stays hidden, and output at commands.ts:333-334 says 'would be written'; usage line prints 'npm run dev --' instead of poe-code"
comment: "Keep as canonical for the gh install preview problem and merge ux-gh-install-dry-run-lists-paths-without-panel.md into it. It raises the right question: the output speaks in 'would be written' language while help documents no --dry-run, so it is unclear whether preview or write is the default - a dangerous ambiguity for a command that writes into .github/. Settle the default, document the flag, then frame the output."
---

# UX: gh install previews with "would be written" but --dry-run not in help

## Summary

gh install fix-vulnerabilities (with --dry-run passed) showed would be written paths and eject tip — preview language good; help only --eject, no --dry-run; npm run dev identity.

## Evidence

install help: [name], --eject. Output uses would be written language.

## Why it matters

Document whether default is preview or write; add --yes for write.

## Suggested direction

Explicit --dry-run/--yes; displayBinaryName.

## Severity

Medium

## Area

GitHub workflows

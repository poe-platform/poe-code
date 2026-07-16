---
severity: medium
impact: usability
reproduced: y
recommendation: fix
evidence: "npm run dev -- --help lists 39 commands (install..usage); neither doctor nor completion registered; rg finds no command in src/cli/commands"
comment: "Bundles two independent gaps (doctor and completion) with separate owners and separate value; split. It is also one of four doctor filings - consolidate those into ux-doctor-still-missing-reconfirmed-2026-07-08.md and file the completion half under ux-completion-command-missing.md."
---

# UX: doctor and completion still missing (reconfirmed)

## Summary

doctor and completion remain Unknown command — reconfirm doctor gap and completion gap.

## Evidence

```bash
$ poe-code doctor
■  Unknown command: doctor
$ poe-code completion
■  Unknown command: completion
```

## Why it matters

Reconfirm missing diagnostic and shell completion commands.

## Suggested direction

Add doctor overview; add completion generators.

## Severity

Medium

## Area

Help

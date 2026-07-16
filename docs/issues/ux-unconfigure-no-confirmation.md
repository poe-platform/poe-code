---
severity: medium
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/commands/unconfigure.ts:47-125 - executeUnconfigure reads only flags.dryRun from resolveCommandFlags and proceeds straight to registry.invoke unconfigure + unconfigureService; rg finds zero assumeYes/confirmOrCancel/requireInteractiveStdin references in the file, unlike the real guard at src/cli/commands/memory.ts:556-564. Probe 'npm run dev -- unconfigure --help' lists only -h, no confirmation gate. logout.ts also lacks a guard and delegates to executeUnconfigure."
comment: "Contentless and, importantly, inferred from help rather than tested ('Evidence: unconfigure help') - the same method that produced the false claims in ux-memory-clear-no-yes-no-dry-run.md and ux-provider-logout-no-confirmation.md, both of which asserted missing guards that actually exist. Do not schedule until someone runs unconfigure non-TTY without --yes. The help gap is real regardless."
---

# UX: unconfigure no confirmation

## Summary

Immediate rewrite no --yes gate.

## Evidence

unconfigure help.

## Why it matters

Destructive.

## Suggested direction

Confirm/--yes.

## Severity

Medium

## Area

Destructive

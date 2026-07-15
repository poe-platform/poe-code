---
severity: medium
impact: discoverability
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

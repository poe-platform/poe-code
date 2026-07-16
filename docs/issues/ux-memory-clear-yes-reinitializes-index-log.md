---
severity: low
impact: none
reproduced: y
recommendation: no-fix
evidence: "packages/memory/src/write.ts:94 clearMemory calls initMemory so INDEX.md/LOG.md return; src/cli/commands/memory.ts:545 clear honours --yes; `npm run dev -- memory clear --help` lists only -h, --help (--yes is a root-level option)"
comment: "Positive-ish, and its incidental observation is more interesting than its headline: after clear --yes, INDEX.md and LOG.md remain because clear re-initialises them - the same pair that ux-memory-index-still-broken-after-init-reconfirmed.md shows cannot be read back by show/ls. So this quietly confirms the files exist on disk while the Critical says they are unreachable, strengthening that filing. Consolidate with ux-memory-clear-yes-works-when-initialized.md."
---

# UX: memory clear --yes clears and re-inits INDEX/LOG (positive-ish)

## Summary

memory clear --yes after init: Cleared memory; INDEX.md and LOG.md remain (re-initialized). Clear works with --yes; help still omits --yes.

## Evidence

◆  Cleared memory.
# INDEX.md LOG.md pages/ still present after clear

## Why it matters

Positive clear with --yes; help gap remains.

## Suggested direction

Document --yes; design-system already good.

## Severity

Low

## Area

Memory / positive pattern

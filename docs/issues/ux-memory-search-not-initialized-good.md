---
severity: low
impact: none
comment: "Duplicate of ux-memory-ingest-not-init-good.md and ux-memory-status-not-initialized-good.md - the same not-initialized message filed three times across the group. Consolidate into one note: the message is good and consistent, which is itself the finding. Its detail that the message uses the correct 'poe-code' binary name is worth keeping as a counterexample to the npm run dev identity cluster."
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/memory.ts:260-267 search action calls assertInitialized; src/cli/commands/memory.ts:79-85 throws 'Memory is not initialized. Run \"poe-code memory init\" in this project.' - message confirmed present, positive note with no defect"
---

# UX: memory search without init is clear (positive)

## Summary

memory search without init: Memory is not initialized. Run poe-code memory init — clear recovery with binary name.

## Evidence

Memory is not initialized. Run "poe-code memory init" in this project.

## Why it matters

Positive not-initialized messaging.

## Suggested direction

Keep.

## Severity

Low

## Area

Memory / positive pattern

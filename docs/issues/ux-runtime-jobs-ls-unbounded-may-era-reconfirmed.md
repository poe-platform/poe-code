---
severity: high
impact: usability
comment: "Keep as canonical of the runtime jobs unbounded-list cluster: most specific evidence (May 2026 exited rows plus pending e2b rows with blank STARTED) and it identifies the second defect the others miss - pending rows with no start time, state that should have been reconciled or pruned. Absorbs ux-runtime-jobs-list-unbounded-opaque-statuses.md and ux-runtime-jobs-ls-unbounded-stale-from-may.md. Fix is two parts: default window plus GC."
---

# UX: runtime jobs ls still unbounded May-era rows (reconfirmed)

## Summary

runtime jobs ls dumps many May 2026 exited jobs plus pending e2b rows with blank STARTED — unbounded opaque list.

## Evidence

jobs from 2026-05-04 … many rows; pending with STARTED -

## Why it matters

Reconfirm runtime job GC + --limit/--since.

## Suggested direction

Default --since 7d; --limit; GC stale pending.

## Severity

**High**

## Area

Runtime jobs

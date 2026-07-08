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

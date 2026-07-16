---
severity: low
impact: none
comment: "Positive pattern; consolidate with the spawn/test-works positives (goose, codex, sonnet-4.6). Individually these carry no decision; collectively they establish the important control for the sonnet-5 cluster - every agent works when handed a live model, so the defaults are the defect rather than the spawn paths."
reproduced: n
recommendation: no-fix
evidence: "Positive note, no defect; src/providers/cursor.ts:28-38 wires spawn/stdin plus a cursor spawn health check, consistent with the reported success"
---

# UX: spawn/test cursor with haiku work (positive)

## Summary

spawn cursor and test cursor with anthropic/claude-haiku-4.5 succeed.

## Evidence

spawn cursor → ok; test cursor → Tested Cursor.

## Why it matters

Positive cursor path.

## Suggested direction

Keep.

## Severity

Low

## Area

Spawn / positive pattern

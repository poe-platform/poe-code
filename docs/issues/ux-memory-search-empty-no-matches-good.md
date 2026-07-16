---
severity: low
impact: none
comment: "Positive pattern; consolidate into the memory empty-state note with the ls/lint/cache-status positives. Its parenthetical is the useful part and recurs across the group: every memory positive quietly notes INDEX remains unshowable, a good signal that the Critical (ux-memory-show-cannot-open-root-index-file.md) dominates this group's real problems."
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/memory.ts:270-272 - searchMemory zero hits writes 'No matches.' and returns; positive note, no defect to reproduce"
---

# UX: memory search no matches is clear after init (positive)

## Summary

memory search foo after init: No matches. — clear empty search (INDEX still not showable).

## Evidence

No matches.

## Why it matters

Positive search empty; INDEX path still broken for show/ls.

## Suggested direction

Keep search empty; fix INDEX show/ls.

## Severity

Low

## Area

Memory / positive pattern

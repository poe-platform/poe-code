---
severity: low
impact: none
comment: "Positive pattern; duplicate of ux-markdown-read-section-by-number-works.md (same command, different section number). Consolidate. Its value is bounding the wrong-hint bug: lookup by number works, so only the miss path is broken."
reproduced: n
recommendation: no-fix
evidence: "packages/markdown-reader/src/core/resolve.ts:9-13 matches section.number first; `npm run dev -- plan markdown-read-section docs/plans/32-agent-goal.md 2` printed '## 2. User-facing shape'"
---

# UX: plan markdown-read-section by number works (positive)

## Summary

plan markdown-read-section … "2" returns section 2 User-facing shape content correctly.

## Evidence

markdown-read-section by "2" → ## 2. User-facing shape body.

## Why it matters

Positive section selection by number.

## Suggested direction

Keep; fix wrong recovery command on miss.

## Severity

Low

## Area

Plan / positive pattern

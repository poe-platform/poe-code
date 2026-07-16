---
severity: low-medium
impact: polish
comment: "Third filing of the profiles table; its only advantage is the actual rendered table in the evidence, which is worth carrying into the survivor. Otherwise a duplicate - retire."
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- code-review profiles prints the bare box table from Evidence; packages/toolcraft/src/renderer.ts:427 routes array results to renderArrayTable (no panel), while objects get renderObjectCard at renderer.ts:412 - generic auto-renderer behaviour, not code-review specific; duplicate filing per comment"
---

# UX: code-review profiles prints raw table without design-system panel

## Summary

code-review profiles dumps a minimal ascii table of name/source without Poe panel framing used elsewhere.

## Evidence

```text
┌─────────┬──────────┐
│ name    │ source   │
│ generic │ built-in │
└─────────┴──────────┘
```

## Why it matters

Dual presentation language; toolcraft group.

## Suggested direction

Design-system table + panel.

## Severity

Low–Medium

## Area

Code-review

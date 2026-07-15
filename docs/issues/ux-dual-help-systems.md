---
severity: high
impact: usability
comment: "Thin on evidence (references screenshots that are not included) but names the largest structural problem in the audit: Commander-rendered help and toolcraft-rendered help are two different UIs under one binary, and that is the parent of many individual filings - double errors, npm run dev lines, unframed output, missing examples. Keep as the umbrella and attach the per-command help issues to it; fixing them individually without unifying the formatter guarantees they drift apart again. Needs the concrete comparison pasted in to be actionable."
---

# UX: Two incompatible help formats

## Summary

Commander vs toolcraft help completely different UIs.

## Evidence

configure vs approvals screenshots.

## Why it matters

Two products under one binary.

## Suggested direction

Unify help formatter.

## Severity

**High**

## Area

Help

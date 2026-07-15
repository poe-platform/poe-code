---
severity: critical
impact: correctness
comment: "Critical is defensible only as a collision, not as a new defect: it stacks three already-filed bugs (empty flag ignored, dead sonnet-5 default, success glyph on failure) into one transcript. Nothing here needs its own fix - the empty-flag policy (ux-empty-model-flag-behavior-inconsistent.md), the constants change (ux-constants-source-of-dead-sonnet-5.md) and the glyph fix (ux-failure-shown-as-success-markers.md) close it entirely. Its value is as evidence of how the three compound; retire into those rather than scheduling separately."
---

# UX: gaslight --model "" falls back to dead claude-sonnet-5

## Summary

gaslight … --model "" still runs Implement prompt and fails API Error: Unsupported model: claude-sonnet-5 with success glyphs then failure — empty model ignored; dead default used.

## Evidence

```bash
$ poe-code gaslight docs/plans/README.md --mode read --yes --model ""
✓ agent: API Error: 400 Unsupported model: 'claude-sonnet-5'.
■  Gaslight round 1 failed …
```

## Why it matters

Empty model + dead default cluster collision; success glyphs on failure.

## Suggested direction

Reject empty --model; never default to sonnet-5; no ✓ on failure.

## Severity

**Critical**

## Area

Gaslight / models

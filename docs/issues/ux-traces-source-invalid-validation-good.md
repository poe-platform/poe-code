---
severity: low
impact: none
comment: "One of three near-identical traces --source positives; consolidate. Its 'copy to models --feature' direction is the actionable half and pairs with ux-models-feature-bogus-silent-empty.md: traces rejects an unknown source with an allow-list while models silently returns zero, so the good pattern already exists next door."
---

# UX: traces --source invalid validation is good (positive)

## Summary

Unsupported trace source lists Expected one of: claude, codex, poe-code without stack.

## Evidence

```bash
$ poe-code traces --source bogus
■  Unsupported trace source "bogus". Expected one of: claude, codex, poe-code.
```

## Why it matters

Positive allow-list validation.

## Suggested direction

Keep; copy to models --feature etc.

## Severity

Low

## Area

Traces / positive pattern

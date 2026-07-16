---
severity: low
impact: none
comment: "One of three near-identical traces --source positives; consolidate. Its 'copy to models --feature' direction is the actionable half and pairs with ux-models-feature-bogus-silent-empty.md: traces rejects an unknown source with an allow-list while models silently returns zero, so the good pattern already exists next door."
reproduced: n
recommendation: no-fix
evidence: "Positive note, no defect: src/cli/commands/traces.ts:13,31-34 confirms TRACE_SOURCES allow-list throws ValidationError 'Unsupported trace source ... Expected one of: ...' as praised; body's 3-source list omits 'pi' (traces-command.test.ts:203)"
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

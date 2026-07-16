---
severity: low
impact: none
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/gaslight.ts:399 calls parsePositiveInteger(options.limit, '--limit'); gaslight.ts:231-240 throws ValidationError('--limit must be a positive integer.') for values <= 0, matching the filed output. No defect."
comment: "Positive pattern; one of several near-identical 'positive integer validation' filings across gaslight, spawn and pipeline. Consolidate the family into one reference note - the rule is already established and repeating it per flag adds nothing."
---

# UX: gaslight ingest --limit 0 validates cleanly (positive)

## Summary

--limit must be a positive integer for limit 0 — good ValidationError.

## Evidence

```bash
$ poe-code gaslight ingest --limit 0 --yes
■  --limit must be a positive integer.
```

## Why it matters

Positive validation.

## Suggested direction

Keep.

## Severity

Low

## Area

Gaslight / positive pattern

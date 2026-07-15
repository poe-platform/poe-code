---
severity: low
impact: none
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

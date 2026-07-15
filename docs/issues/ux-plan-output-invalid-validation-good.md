---
severity: low
impact: none
comment: "Positive pattern; third filing of the plan list enum-validation praise. Consolidate into the one that covers both flags. Its 'use for all enum flags' direction is the actionable half and is exactly what the models and hooks enum filings need."
---

# UX: plan list invalid --output validates cleanly (positive)

## Summary

Invalid --output value "bad" returns Expected one of: terminal, md, json without raw Commander skin.

## Evidence

```bash
$ poe-code plan list --output bad
■  Invalid --output value "bad". Expected one of: terminal, md, json.
```

## Why it matters

Positive validation pattern.

## Suggested direction

Keep; use for all enum flags.

## Severity

Low

## Area

Plan / positive pattern

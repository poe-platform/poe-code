---
severity: medium
impact: usability
comment: "Contentless but names a genuine first-run problem: 341 rows by default is unusable, and the in-product precedent for the fix already exists - gaslight ingest defaults to --since 30d --limit 200 (ux-gaslight-ingest-has-limit-since-good.md). Also relevant: ux-models-no-limit-flag-confirmed.md reports there is no --limit here at all. Consolidate those and treat bounded output as one convention decision."
reproduced: y
recommendation: fix
evidence: "src/cli/commands/models.ts:262-273 registers only filter options, no --limit and no default cap; with no filters filtered stays allModels (line 371) and all rows render via renderTable (line 539)"
---

# UX: models dumps full catalog

## Summary

300+ rows default.

## Evidence

unfiltered models.

## Why it matters

Unusable first-run.

## Suggested direction

Default short; --all.

## Severity

Medium

## Area

Models

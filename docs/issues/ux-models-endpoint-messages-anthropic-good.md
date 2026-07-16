---
severity: low
impact: none
comment: "Positive pattern; one of several models multi-filter positives. Consolidate the family into one note: filter composition works well across the board, which is the actual finding and a useful counterweight to the models cluster's validation gaps. Its incidental detail is worth keeping - opus-4.8 is in the catalog, relevant to the pin-policy question in ux-agent-default-opus-4-7-not-latest-opus-4-8.md."
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/models.ts:372-407 - --provider and --endpoint filters compose via sequential narrowing of the same filtered list; no defect described"
---

# UX: models --endpoint /v1/messages --provider anthropic works (positive)

## Summary

models --endpoint /v1/messages --provider anthropic returns 8 anthropic models including sonnet-4.6 and opus-4.7/4.8.

## Evidence

8/341 anthropic messages endpoint models.

## Why it matters

Positive multi-filter composition.

## Suggested direction

Keep.

## Severity

Low

## Area

Models / positive pattern

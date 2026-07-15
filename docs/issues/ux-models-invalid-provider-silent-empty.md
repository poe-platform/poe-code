---
severity: high
impact: correctness
comment: "Keep for the specific evidence it uniquely carries: it contrasts --provider (silently empty) with --endpoint (validates and lists valid values) in the same command, proving the inconsistency is internal to models rather than a missing capability. That contrast is the strongest argument in the whole silent-filter cluster and must survive consolidation. Note providers are catalog-derived, so the allow-list can be generated rather than hard-coded."
---

# UX: models --provider not-a-provider silently empties

## Summary

models --provider not-a-provider → 0/341 No models match — no error that provider is unknown (contrast endpoint which validates).

## Evidence

--provider not-a-provider → empty; --endpoint /v1/bogus → ValidationError with available endpoints.

## Why it matters

Inconsistent filter validation; unknown provider looks like empty catalog.

## Suggested direction

Reject unknown providers with allow-list from catalog.

## Severity

**High**

## Area

Models

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

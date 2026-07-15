---
severity: low
impact: none
comment: "Positive pattern, no code change; genuinely distinct from the two field-shape positives because it praises the help text rather than the payload. Its 'add status --json for parity' suggestion contradicts the cheaper cross-link direction preferred in ux-auth-status-no-json-flag.md - resolve the human-vs-machine convention once CLI-wide instead of in two files."
---

# UX: auth whoami help documents JSON output (positive)

## Summary

auth whoami help says Print Poe account identity as JSON (uses POE_API_KEY if set) — clear machine mode vs status.

## Evidence

whoami help documents JSON and POE_API_KEY.

## Why it matters

Positive machine/human split documentation.

## Suggested direction

Keep; add status --json for parity.

## Severity

Low

## Area

Auth / positive pattern

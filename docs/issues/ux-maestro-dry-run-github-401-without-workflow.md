---
severity: high
impact: usability
comment: "One of four filings of the same maestro dry-run finding; consolidate into ux-maestro-dry-run-path-vs-flag-confusion.md, the most complete. The shared point is correct and the more interesting half: --dry-run performs a network call and fails on GitHub auth before validating the local workflow, so dry-run is neither offline nor local-first and users cannot preview anything without credentials. The raw GraphQL 401 JSON is the secondary defect."
---

# UX: maestro --dry-run hits GitHub 401 without local workflow check first

## Summary

maestro --dry-run --yes with missing/default WORKFLOW.md fails with raw GitHub GraphQL 401 Bad credentials — network/auth before local config validation.

## Evidence

GitHub GraphQL request failed with status 401: Bad credentials

## Why it matters

Dry-run should validate local workflow first; auth errors need gh auth login recovery.

## Suggested direction

Validate WORKFLOW.md exists; then auth; UserError without raw JSON.

## Severity

**High**

## Area

Maestro

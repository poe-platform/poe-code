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

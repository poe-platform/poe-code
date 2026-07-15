---
severity: high
impact: data-loss
comment: "Duplicate of ux-tasks-import-delete-source-dangerous.md (same flag on the sibling command); consolidate into one --delete-source safety issue. Same caveat: the claim is inferred from help text rather than tested, so verify whether --yes is already enforced before scheduling."
---

# UX: tasks move --delete-source is dangerous without --yes requirement in help

## Summary

tasks move has --delete-source without documenting --yes requirement or irreversibility (same class as import --delete-source).

## Evidence

tasks move --help: --delete-source Delete source tasks after successful creation.

## Why it matters

Data loss risk on mis-aimed move.

## Suggested direction

Require --yes; dry-run lists deletions; strong help warning.

## Severity

**High**

## Area

Tasks / destructive

---
severity: high
impact: data-loss
comment: "Legitimate and correctly High: --delete-source removes the user's markdown after import with no documented --yes requirement and no preview - the same shape as the destructive commands this audit has already proved will delete real files. Consolidate with ux-tasks-move-delete-source-dangerous.md (same flag, two commands). Its fix is right: require --yes and list the files a dry-run would delete. Unverified though: nobody ran it, so confirm whether a guard already exists before rating - the memory clear lesson applies."
---

# UX: tasks import --delete-source is dangerous without strong warnings

## Summary

tasks import has --delete-source to delete markdown after import and --keep — help does not emphasize irreversibility or require --yes for delete.

## Evidence

tasks import --help: --delete-source Delete source files after successful creation.

## Why it matters

Data loss risk if import mis-targeted.

## Suggested direction

Require --yes with --delete-source; dry-run lists files to delete.

## Severity

**High**

## Area

Tasks / destructive

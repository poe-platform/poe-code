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

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

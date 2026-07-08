# UX: provider logout poe --dry-run also rewrites agent configs

## Summary

provider logout poe --dry-run not only rm credentials.poe.enc but also rewrites goose config and more — broader than credential logout (related logout overclaims).

## Evidence

rm credentials.poe.enc; rm credentials.enc; rewrite goose config.yaml…

## Why it matters

Provider logout looks like full unconfigure for agents using poe.

## Suggested direction

Separate credential logout from agent unconfigure; intentional-only diffs.

## Severity

**High**

## Area

Providers / destructive

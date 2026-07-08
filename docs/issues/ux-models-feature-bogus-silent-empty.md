# UX: models --feature bogus silently returns empty (reconfirmed filter semantics)

## Summary

Invalid feature name returns 0 models / No models match rather than invalid feature error — reconfirm of silent filter issues.

## Evidence

```bash
$ poe-code models --feature bogus
●  0/341 models
●  No models match the given filters.
```
Help says feature is tools, web_search, or reasoning.

## Why it matters

Typos look like empty catalog.

## Suggested direction

Validate --feature against allow-list; suggest valid names.

## Severity

Medium

## Area

Models

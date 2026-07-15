---
severity: medium
impact: usability
comment: "Keep as canonical of this pair: a missing --config path is a user error, so a raw ENOENT plus 'See logs' is the wrong presentation. Same bare-throw mechanism as ux-editor-missing-raw-error.md - unvalidated fs access surfacing as system chrome. Its 'suggest gaslight install' recovery is the useful half."
---

# UX: gaslight --config missing file is ENOENT system chrome

## Summary

gaslight --config /tmp/no-gaslight.yaml: ENOENT open + See logs — should be ValidationError config not found.

## Evidence

ENOENT: no such file or directory, open '/tmp/no-gaslight.yaml' 

## Why it matters

UserError without logs; suggest gaslight install.

## Suggested direction

Config not found: path.

## Severity

Medium

## Area

Gaslight

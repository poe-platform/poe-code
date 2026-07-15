---
severity: low
impact: none
comment: "Third duplicate of the traces --source positive; retire. One detail worth checking rather than carrying: it lists 'claude, codex, pi, poe-code' while the sibling filings list only 'claude, codex, poe-code' - either the set changed between probes or one file is inaccurate, worth resolving since these files are cited as the allow-list reference."
---

# UX: traces --source bogus validation is good (positive)

## Summary

traces --source bogus: Unsupported trace source "bogus". Expected one of: claude, codex, pi, poe-code — clear ValidationError without stack.

## Evidence

Unsupported trace source "bogus". Expected one of: claude, codex, pi, poe-code.

## Why it matters

Positive source validation pattern.

## Suggested direction

Keep; apply to approvals state enums.

## Severity

Low

## Area

Traces / positive pattern

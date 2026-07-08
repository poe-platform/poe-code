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

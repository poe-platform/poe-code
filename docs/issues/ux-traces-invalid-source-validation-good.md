# UX: traces invalid --source validation is good (positive)

## Summary

traces --source bogus: Unsupported trace source "bogus". Expected one of: claude, codex, poe-code — clear ValidationError.

## Evidence

Expected one of: claude, codex, poe-code.

## Why it matters

Positive source validation.

## Suggested direction

Keep.

## Severity

Low

## Area

Traces / positive pattern

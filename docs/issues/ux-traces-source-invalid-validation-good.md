# UX: traces --source invalid validation is good (positive)

## Summary

Unsupported trace source lists Expected one of: claude, codex, poe-code without stack.

## Evidence

```bash
$ poe-code traces --source bogus
■  Unsupported trace source "bogus". Expected one of: claude, codex, poe-code.
```

## Why it matters

Positive allow-list validation.

## Suggested direction

Keep; copy to models --feature etc.

## Severity

Low

## Area

Traces / positive pattern

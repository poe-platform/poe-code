# UX: memory cache clear requires --yes (positive destructive guard)

## Summary

memory cache clear without --yes refuses with Refusing to clear cache without --yes — good guard (still See logs system chrome).

## Evidence

```bash
$ poe-code memory cache clear
■  Error: Refusing to clear cache without --yes.
●  See logs …
```

## Why it matters

Positive pattern for destructive ops; drop See logs.

## Suggested direction

Keep --yes requirement; ValidationError without logs; document in help.

## Severity

Low

## Area

Memory / positive pattern

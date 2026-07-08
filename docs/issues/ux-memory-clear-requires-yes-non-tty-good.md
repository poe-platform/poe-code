# UX: memory clear non-TTY requires --yes (positive)

## Summary

memory clear without --yes: memory clear requires --yes when running without an interactive TTY — clear destructive guard (help still omits --yes).

## Evidence

```bash
$ poe-code memory clear
■  memory clear requires --yes when running without an interactive TTY.
```

## Why it matters

Positive non-TTY destructive guard; document --yes on help.

## Suggested direction

Add --yes to memory clear help; keep requirement.

## Severity

Low

## Area

Memory / positive pattern

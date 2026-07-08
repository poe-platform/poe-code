# UX: plan view non-TTY requires path or --yes (positive)

## Summary

plan view without path: Plan selection requires a path or --yes when running without an interactive TTY — clear non-TTY contract.

## Evidence

```bash
$ poe-code plan view
■  Plan selection requires a path or --yes when running without an interactive TTY.
```

## Why it matters

Positive non-TTY message (contrast plan browse dumping body).

## Suggested direction

Apply same pattern to plan browse.

## Severity

Low

## Area

Plan / positive pattern

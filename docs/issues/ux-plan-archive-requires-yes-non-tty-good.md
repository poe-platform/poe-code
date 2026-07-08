# UX: plan archive non-TTY requires --yes when path given (positive)

## Summary

plan archive docs/plans/32-agent-goal.md --output md without --yes: plan archive requires --yes when running without an interactive TTY — clear contract; file not archived.

## Evidence

```bash
$ poe-code plan archive docs/plans/32-agent-goal.md --output md
■  plan archive requires --yes when running without an interactive TTY.
```
File remains in place.

## Why it matters

Positive non-TTY guard for destructive plan ops with path; still missing from help; --yes without path still Critical.

## Suggested direction

Document --yes on help; keep path+--yes requirement.

## Severity

Low

## Area

Plan / positive pattern

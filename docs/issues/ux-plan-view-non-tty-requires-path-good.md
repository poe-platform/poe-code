---
severity: low
impact: none
comment: "Important small positive: 'Plan selection requires a path or --yes when running without an interactive TTY' is the exact message plan browse and bare plan should emit instead of dumping an arbitrary plan body. Its own suggestion says so. Keep and link from the non-TTY dump cluster - it proves the fix is reuse rather than design, the same shape as the login hang and its --yes counterpart."
---

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

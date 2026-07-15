---
severity: low
impact: none
comment: "Small positive that is decisive for the Critical: it proves the non-TTY --yes guard works when a path is supplied and the file is left untouched. Read with ux-plan-archive-delete-yes-picks-arbitrary-plan.md it isolates the bug precisely - the guard is on the confirmation, not on target selection, so --yes without a path skips straight past it to an autopicked victim. Keep and link; it turns a vague 'add confirmation' into a specific fix."
---

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

# UX: ralph run on plan-kind doc says Ralph doc not found

## Summary

ralph run docs/plans/32-agent-goal.md (kind: plan) says Ralph doc not found — same wrong-kind-as-missing pattern as experiment journal.

## Evidence

```bash
$ poe-code ralph run docs/plans/32-agent-goal.md --yes
■  Ralph doc not found: docs/plans/32-agent-goal.md
```

## Why it matters

File exists; need kind mismatch message + how to ralph init.

## Suggested direction

Expected kind ralph, found plan; suggest ralph init.

## Severity

**High**

## Area

Ralph

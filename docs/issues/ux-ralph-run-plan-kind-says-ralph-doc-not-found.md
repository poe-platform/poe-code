---
severity: high
impact: usability
comment: "One of two filings of ralph run's wrong-kind message; consolidate. Its framing is the better one and names the shared pattern explicitly, which is the argument for fixing kind resolution once across ralph, experiment and superintendent. Its suggestion to point at ralph init is right in principle but blocked by ux-ralph-init-requires-existing-ralph-doc-circular.md - the recommended recovery does not currently work. Sequence the init fix first."
---

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

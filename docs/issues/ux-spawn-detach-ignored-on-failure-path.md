# UX: spawn --detach still runs foreground failure path for model errors

## Summary

With --detach, spawn still appears to run the agent path that fails on stale model in-foreground with success markers, rather than clearly detaching or failing preflight before detach.

## Evidence

```bash
$ poe-code spawn claude "hi" --mode read --detach
✓ agent: API Error: 400 Unsupported model…
■  Error: Claude Code spawn failed with exit code 1
```

## Why it matters

--detach contract unclear on failure; users expect job id or preflight.

## Suggested direction

Preflight model/config before detach; on detach print job id; document semantics.

## Severity

Medium

## Area

Spawn / runtime

# UX: --runner-sync without --detach is silently ignored

## Summary

spawn … --runner-sync both without --detach/--runtime succeeds inline — flag has no effect, no warning.

## Evidence

spawn --runner-sync both → inline success like normal spawn.

## Why it matters

Detached-runtime flags should require runtime context.

## Suggested direction

Error: --runner-sync requires --detach and --runtime docker|e2b.

## Severity

**High**

## Area

Spawn / runtime

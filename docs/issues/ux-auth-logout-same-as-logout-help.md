# UX: auth logout help identical to root logout (factory-reset copy)

## Summary

auth logout help says Remove all configuration and credentials same as root logout — if auth logout is alias of full factory reset, it is misnamed under auth group.

## Evidence

```text
auth logout: Remove all configuration and credentials.
logout: Remove all configuration and credentials.
```

## Why it matters

Users expect auth logout to only clear credentials, not unconfigure agents.

## Suggested direction

If full reset: rename/warn; if credentials-only: implement and document difference.

## Severity

**High**

## Area

Auth / destructive

# UX: login without key hangs non-TTY on OAuth

## Summary

Bare login starts OAuth wait forever without TTY.

## Evidence

login non-TTY Waiting for authorization hang.

## Why it matters

Hang worse than clear error.

## Suggested direction

Fail-fast non-TTY without --api-key.

## Severity

**High**

## Area

Auth / CI

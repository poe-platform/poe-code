# UX: --detach without --runtime still runs inline (reconfirmed)

## Summary

spawn … --detach without --runtime host/docker/e2b still runs inline with ✓ agent and Resume — no job id (related detach+host still-inline).

## Evidence

spawn … --detach → inline success, no job id.

## Why it matters

Reconfirm detach requires runtime context.

## Suggested direction

Error: --detach requires --runtime docker|e2b; or return job id for host.

## Severity

**High**

## Area

Spawn / runtime

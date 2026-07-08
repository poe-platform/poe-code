# UX: Empty --api-key silently ignored

## Summary

--api-key '' falls back to stored key.

## Evidence

agent --api-key ''.

## Why it matters

Explicit flag discarded.

## Suggested direction

Require non-empty if present.

## Severity

Medium

## Area

Auth

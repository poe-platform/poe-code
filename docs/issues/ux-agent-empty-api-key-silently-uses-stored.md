# UX: agent --api-key "" silently uses stored key

## Summary

agent "…" --api-key "" succeeds with tokens — empty api-key ignored, uses stored auth (same empty-flag class).

## Evidence

agent --api-key "" → success with tokens.

## Why it matters

Explicit empty should error not fall back silently.

## Suggested direction

Reject empty --api-key when flag present.

## Severity

Medium

## Area

Agent

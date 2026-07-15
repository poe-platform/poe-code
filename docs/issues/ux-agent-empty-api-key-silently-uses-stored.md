---
severity: medium
impact: correctness
comment: "Valid: an explicitly passed empty flag should be a ValidationError, not a silent fallback to stored auth - the user asked for something specific and silently got something else. Mild security edge: the run is authenticated and billed against a key the user did not intend to use. Part of a systemic empty-flag family with ux-empty-api-key-flag-silently-ignored.md and ux-skills-empty-string-silently-ignored.md; decide once that an explicit empty string always errors, then apply across flags."
---

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

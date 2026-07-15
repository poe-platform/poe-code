---
severity: low
impact: none
comment: "Positive pattern; duplicate of ux-provider-login-anthropic-dry-run-good.md - same command, same conclusion. Consolidate. The pair is genuinely useful as the contrast case: provider login's dry-run stays credential-scoped and prints no secret, exactly what provider login poe fails to do (ux-provider-login-poe-dry-run-rewrites-claude-settings-xhigh.md). Same command, different provider, wildly different blast radius."
---

# UX: provider login anthropic --dry-run is clean (positive)

## Summary

provider login anthropic --api-key sk-fake --dry-run: would save credential; no filesystem changes — clean dry-run without printing key.

## Evidence

Dry run: would save credential for anthropic. # no filesystem changes

## Why it matters

Positive dry-run for credentials.

## Suggested direction

Keep.

## Severity

Low

## Area

Providers / positive pattern

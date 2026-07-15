---
severity: low-medium
impact: usability
comment: "Almost-positive: the message names the bad value and points at provider list, which is the good recovery shape - only the 'See logs' tease is wrong. Retire into ux-user-errors-look-like-system-failures.md. Worth noting the inconsistency it exposes with ux-configure-unknown-provider-validation-good.md, where configure's equivalent error has no See logs: same class, two behaviors."
---

# UX: provider login unknown has list hint but still See logs

## Summary

provider login not-a-provider: Unknown provider … Run provider list — good next step; still See logs system chrome.

## Evidence

Unknown provider + Run provider list + See logs.

## Why it matters

Almost good; drop See logs.

## Suggested direction

UserError without logs.

## Severity

Low–Medium

## Area

Providers

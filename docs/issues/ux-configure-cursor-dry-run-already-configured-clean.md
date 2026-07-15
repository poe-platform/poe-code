---
severity: low
impact: none
comment: "Direct contradiction with ux-configure-cursor-dry-run-no-filesystem-changes.md and ux-configure-cursor-dry-run-too-quiet.md, which call this identical output opaque and useless. Resolve rather than keeping both readings: 'no filesystem changes' is honest for a no-op, but it never says what configure would have done - so the behavior is fine and the explanation is missing. Its 'apply to skip-if-configured' suggestion is the valuable part: that is exactly what the Critical skip-if-configured files are asking for."
---

# UX: configure cursor --yes --dry-run already configured is clean (positive)

## Summary

configure cursor --yes --dry-run: would configure Cursor; # no filesystem changes — clean intentional dry-run when no-op.

## Evidence

Dry run: would configure Cursor.
# no filesystem changes

## Why it matters

Positive dry-run no-op pattern.

## Suggested direction

Keep; apply to skip-if-configured.

## Severity

Low

## Area

Configure / positive pattern

---
severity: high
impact: usability
comment: "Duplicate within the blank-ID cluster; retire. Its one distinct claim is worth verifying rather than assuming: that rows persist after launch rm, which would make this a GC bug independent of the malformed-id cause suspected in ux-launch-start-via-npm-run-dev-confuses-argv.md. Test that exact sequence with the installed binary."
---

# UX: launch status shows blank ID "-" zombie rows after rm

## Summary

After launch rm, status still lists rows with ID - STATUS stopped — registry not cleaned; table fills with ghosts.

## Evidence

launch status after rm → multiple rows with ID "-" stopped.

## Why it matters

Unusable process table; looks broken.

## Suggested direction

Prune blank-id entries; hide stopped blank rows by default.

## Severity

**High**

## Area

Launch

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

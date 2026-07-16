---
severity: medium
impact: none
reproduced: n
recommendation: no-fix
evidence: "packages/process-launcher/src/state/state-store.ts:159 skips '.state-removed-' entries in list(); state-store.test.ts:240 asserts list() returns [] while a tombstone dir remains, so tombstone ids are never surfaced as managed processes"
comment: "Duplicate in substance of ux-launch-status-crashes-on-tombstone-dirs.md, which covers the same .state-removed-* tombstones with better evidence and the wider blast radius; retire into it. Shared root: tombstone directories are read back as process ids."
---

# UX: launch rm on stale removed id is opaque Invalid managed process

## Summary

launch rm - hits Invalid managed process specification for ".state-removed-foo-…" + See logs — leftover tombstone IDs from prior audit launch probes.

## Evidence

Invalid managed process specification for ".state-removed-foo-…"
●  See logs …

## Why it matters

Stale launch state confuses GC; error opaque.

## Suggested direction

GC tombstones; UserError: No managed process. Try launch status.

## Severity

Medium

## Area

Launch

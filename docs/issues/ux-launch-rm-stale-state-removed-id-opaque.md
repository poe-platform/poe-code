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

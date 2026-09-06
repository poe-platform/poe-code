---
title: Explicit array prototype links
---

## Validated gap

SafeJS rejected arrays as prototype targets and prototype values. Native JavaScript
accepts both. Enabling those links also exposed stale implicit methods/iteration
and incorrect inherited HasProperty behavior: `in` read getters and missed
properties whose value was undefined. Native differential tests reproduce each.

## Implementation and validation

Allow explicit array links using the existing cycle and extensibility checks.
Resolve inherited properties normally and disable implicit array methods and
iteration after replacement. Check existence without reading property values.
Run the native differential tests, maintained SafeJS unit suite, scoped lint,
TypeScript, selected workspace build, and this paired harness through the CLI.

## Remaining gaps

This does not complete the default intrinsic prototype graph or portable custom
prototype snapshots. Copy/snapshot rejection is tested explicitly. Investigation
also confirmed Object.preventExtensions is unavailable; it needs its own fix.

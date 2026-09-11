---
title: Object extensibility and sealing
---

## Evidence and scope

Twelve native differential cases failed because Object.preventExtensions,
Object.isExtensible, Object.seal and Object.isSealed were absent. Add these
operations using the existing object descriptors and materialized guest-function
properties. Preserve primitive identity, writable sealed properties, accessor
setters and strict errors for prohibited additions/deletions. Live host objects
must reject seal/preventExtensions just as they reject freeze.

## Validation

Run native differential tests and explicit live-host boundary tests, the maintained
SafeJS package unit suite, scoped ESLint, TypeScript, the selected workspace build,
and this paired harness through the CLI with screenshot inspection. This harness
grants no external capabilities and spawns no agents.

Local results: all 12 native comparisons and two live-host boundary tests pass;
the maintained package suite reports 14,038 passed and 41 skipped. Scoped ESLint
and TypeScript complete successfully.

## Remaining work

This adds the missing object integrity APIs; it does not complete intrinsic
prototype graphs, custom-prototype snapshots, or arbitrary exotic-object support.

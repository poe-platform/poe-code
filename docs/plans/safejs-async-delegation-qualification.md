# Async generator delegation qualification

## Scope and harness

Pinned Test262 72faf8ec1445c55149615e8b35187830783aba1a, all top-level files
whose names contain yield-star under test/language/expressions/async-generator.
Read declared harness includes plus sta.js/assert.js in memory. Run strict
sources in matched async-function wrappers for fresh native VM and SafeJS
execution. For async fixtures, provide a guest-local $DONE backed by a Promise,
await completion, and require the observed callback count to equal one. Do not
count an unresolved callback as a pass. Parse-negative fixtures are compiled
without execution on both sides.

These are adapted source probes, not the official Test262 runner. Wrapping
does not establish Script-global behavior, arbitrary async scheduling,
checkpoint correctness or compatibility on all supported Node versions.

## Results

An initial 11-case Node 22 control selection passes (8873aa): async and sync
next/return/throw delegation, abrupt done/value/then getters, and null return/
throw methods. Each guest execution observes one completion callback.

The full selection uses Node 26.8.1, avoiding older native-oracle differences
in async-from-sync cleanup: 119 runtime passes, one expected parse rejection,
zero exclusions, zero native-control failures and zero guest failures
(8ecd03). Both named and unnamed generator expression forms are represented.
No runtime change follows from this audit.

## Integration and delivery

Main runtime remains dfa158292, with subsequent documentation commits only.
The maintained full-package test remains live in session 5721 (47ebdc), with
all 100 filesystem contracts already passed. Keep the same handle and do not
infer a full-package pass from these source probes. No push or release is
authorized. This documentation-only qualification needs no screenshot.

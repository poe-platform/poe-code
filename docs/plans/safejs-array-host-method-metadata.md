---
title: Array methods without newer native descriptors
---

# Array method metadata without newer native methods

After buffer compatibility commit b578c15c3 was verified on remote main, Node
18.18.0 imports SafeJS successfully but run fails in createArrayGlobal when it
reads `.value.length` from a missing Array.prototype method descriptor. The
runtime implements these guest methods itself; their metadata must not require
newer native implementations. Validate metadata and actual guest execution on
Node 18 without weakening the declared supported runtime range.

Regression probe: `packages/safe-js/src/interp/array-host-method-metadata.test.ts`.
The supported-runtime check exposed this after buffer module import was fixed;
it is not a speculative issue. Reproduce the unit failure before changing code.

Latest scoped publication: @poe-platform/safe-js@0.1.320, run 34095607485,
receipt 2026-09-07T07:32:14.6083252Z (slice commit). Buffer compatibility release
is not yet verified. Latest CLI publication is poe-code@14.0.84 (iterator commit).

The regression failed at the expected metadata lookup before implementation
(`/tmp/poe-safejs-array-host-method-metadata-red.log`). Guest method lengths now
come from one explicit metadata table, with the supported-name set derived from
its keys. Tests compare every supported method against native argument counts
and exercise copying methods while newer native descriptors are unavailable.

Qualification: 743 focused array tests passed across 12 files in 10.04 seconds.
Scoped TypeScript and ESLint passed. The real harness passed after 70 uncached
build tasks (59.552 seconds); inspected
`screenshots/harness-run-docs-plans-safejs-array-host-method-metadata.md.png`:
clean pass, expected fields, zero spawns. The rebuilt run API also passes array
copy-method behavior and ArrayBuffer slicing on native Node 18.18.0. This resolves
the two observed initialization failures without claiming all modern JavaScript
features are available on that host.

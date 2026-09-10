# Conditional test coverage audit

## Native Temporal

The Node 22 package run cannot execute tests requiring a native Temporal.Instant.
On available Node 26.8.1, the maintained files
`structured-clone-host-instant.test.ts` and `temporal-instant-native.test.ts`
pass all 18 cases with no skips (80ca6a). Seven cases exercise the polyfill;
eleven require the native implementation. This validates cloning rejection,
ordinary imports/aliases, native exports, injected bindings and forged-brand
rejection for Instants in this selection. It does not resolve the separate
Intl calendar/offset/extreme-value gaps or establish all Temporal conformance.

## Other conditional routes

Source inspection finds optional parse fuzzing, native Math.f16round comparison
checks and filesystem-reference gaps in addition to native-Temporal conditions.
These conditions should not be removed merely to reduce skipped-test totals.
The obsolete unconditional Proxy/weak-reference no-op was replaced separately;
see [its record](safejs-stale-conformance-skip.md).

The platform-selected macOS fixture in `fs.node-truth.json` declares 33
filesystem-reference gaps (b43d68). The test table records memfs/Node differences
explicitly, including errors, symlink behavior, flags and filesystem mutations.
Three cyclic-link reference cases are not driven because the reference can
block the event loop. This audit inspected the declarations; it did not freshly
reproduce every filesystem gap or establish they are all still necessary.
Do not count these skipped comparisons as filesystem or JavaScript passes.

The ongoing default-Node full-package run is still session 94973. This
conditional selection is separate evidence and does not replace its result.
No runtime change, push or release was made for this audit.

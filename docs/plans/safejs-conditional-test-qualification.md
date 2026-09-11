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

## Native binary16 rounding

On Node 26.8.1, `math-f16round.test.ts` and
`math-f16round.independent.test.ts` pass all 68 tests with no skips (48092e).
The two native-conditional comparisons execute 16,384 deterministic binary64
inputs and 253,952 half-value/tie-neighbor inputs, respectively. Their combined
270,336 comparisons are loop iterations inside tests, not additional tests.
The independent integer-bit oracle and other existing checks also run in this
selection. The independent test file has existing user-owned edits; they were
preserved, not authored or committed as part of this qualification.

The full package process remained live at 14:23 elapsed and was consuming CPU
(8c6cc8). Its report is still pending; this native check does not replace it.

## Separate Number formatting qualification

A read-only strict source probe at Test262 revision
`72faf8ec1445c55149615e8b35187830783aba1a` also passes the following top-level
Number/prototype fixtures on unchanged main, with fresh Node 22.23.2 native VM
controls: toFixed 16, toExponential 15, toPrecision 17, toString 90 (c7a407,
b1ffc8). All 138 guest cases and native controls pass, with no metadata
exclusions or unavailable harness cases. Source and declared harness includes
are loaded in memory, metadata is parsed as YAML, and completion is explicit.
This is not the official runner, does not cover all number semantics, and does
not justify a runtime change. Full-package session 94973 remains live (dac610).

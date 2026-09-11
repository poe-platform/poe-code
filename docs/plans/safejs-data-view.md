---
title: DataView binary access and persistence
---

# Validated gap

Six native-comparison tests failed because DataView was absent. Add the
constructor, three getters and all 22 standard read/write methods, including
BigInt and Float16, following the [ECMAScript algorithms](https://tc39.es/ecma262/multipage/structured-data.html#sec-dataview-constructor).
Reuse native numeric storage operations after guest coercion; reuse existing
budgeted BigInt conversion and binary16 rounding for older hosts.

Preserve backing-buffer identities across native data copying, host operations,
structured cloning, primary snapshots and replay data. Include own properties,
descriptors, cycles and intrinsic identities. Persist fixed and length-tracking
resizable layouts, including temporarily out-of-bounds and detached views.
Use captured native getters for internal state, never guest-shadowed metadata.
Charge backing storage once per graph and enforce capacity limits on import.
SharedArrayBuffer stays capability-closed; unknown native resizable-view layout
is rejected for persistence rather than guessed or discovered by host mutation.

Validate constructor/method coercion order and invalid brands/bounds against
native DataView. Confirm Float16 encoding boundaries and native Node 24 parity,
then old-Node built-SDK behavior. Run maintained SafeJS unit checks, focused lint
and types, the actual harness pair, and inspect its screenshot before the atomic
commit and push. No model calls are needed for this runtime harness.

Testing also reproduced a separate issue: structuredClone currently ignores its
transfer option. Its failing probe remains in structured-clone-transfer.test.ts
for the next atomic fix; DataView detachment tests use ArrayBuffer.transfer.
The unresolved native-Promise property-import probe remains separate too.
Do not report either probe as passing or remove coverage to hide those gaps.

The previous base64 commit published SafeJS 0.1.363 during this work. Keep
monitoring the CLI workflow while working; a green workflow alone does not
prove publication.

The maintained package run completed with 18,803 passes, 41 skips and two
failures (306.30s): an incorrect host-symbol identity assumption in the new test,
and an outdated native AbortError code assertion in the filesystem bridge test.
Replay intentionally creates fresh non-well-known symbols; the corrected test
checks the shared restored key and cycle rather than host identity. The abort
assertion is corrected in its own atomic commit. Both affected files then passed
all 60 tests (2.05s), including 51 DataView tests. The two unfinished probes
documented above were explicitly excluded from the package run.

TypeScript and focused ESLint passed. The real harness passed after 70 uncached
workspace build tasks (62.33s) and root stages; its screenshot was inspected.
Node 18.18 passed built-SDK DataView, Float16, BigInt, string conversion and
public snapshot checks without native Float16 APIs. Node 24.14 passed 262,144
native Float16 comparisons covering every 16-bit pattern in both byte orders.
The first oracle attempt incorrectly required identical NaN payload bits;
ECMAScript NumericToRawBytes permits implementation-chosen NaN encodings.
The corrected oracle compares NaN values and exact encodings for non-NaNs.
No production change was made to satisfy that invalid payload assumption.
No model calls were made. No matching open DataView GitHub issue was found.

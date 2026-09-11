---
title: ArrayBuffer slice
---

# ArrayBuffer slice

The ArrayBuffer foundation exposes construction, capacity, resize and views but
does not yet implement slice. Native-oracle tests now cover byte-copy isolation,
bound coercion order/clamping, subclass species, oversized custom destinations
and rejection of returning the source buffer. Red log:
`/tmp/poe-safejs-array-buffer-slice-red.log`.

Implement branded slice with guest coercion and species construction, preserving
byte contents, custom result identity, capacity semantics and constructor order.
Validate destination brand, length and distinction from source. Add mutation,
resize, invalid species, snapshot and budget tests before considering it ready.
Use the published ECMAScript edition and concrete native comparisons; document
engine/spec differences rather than treating every native mismatch as a bug.

Previous iterator fix is verified on remote main as
`e9be4ebab758bbb8bef3bcaec5f067a2057aa7c7`; 258 focused tests, types/lint, 70
uncached build tasks and the inspected real harness passed. Monitor scoped run
34094300730 and CLI run 34094300838 while implementing slice. Latest verified
scoped publication is @poe-platform/safe-js@0.1.318 from species run 34093858972
at 2026-09-07T07:10:38.8393478Z.

Implemented slice and inherited species with guest coercion, custom construction,
copy isolation and resize-aware copying. Three additional native-backed failures
confirmed missing detached-buffer checks at entry, after constructor callbacks,
and for an empty detached species result. These now pass alongside the 14 earlier
cases, including two snapshot round-trips and direct calls after realm cleanup.
Detached RED evidence: `/tmp/poe-safejs-array-buffer-slice-detached-all-red.log`.
The published [ECMAScript 2026 slice algorithm](https://tc39.es/ecma262/2026/multipage/structured-data.html#sec-arraybuffer.prototype.slice)
is the normative reference for callback ordering and buffer validation.

Scoped iterator publication is now verified: @poe-platform/safe-js@0.1.319,
run 34094300730, receipt 2026-09-07T07:17:25.6015041Z. CLI run 34094300838
remains under observation; scoped publication does not prove CLI publication.

Qualification: 20 focused slice tests passed, including retention after success
and throw and combined source/destination memory-budget enforcement. Full SafeJS
unit route passed 17,919 tests, with 41 skips across 536 passed and one skipped
file, in 284.83 seconds. As in the preceding runs, the unresolved host-Promise
import-policy probe is explicitly excluded; no other test exclusions were added.
Log: `/tmp/poe-safejs-array-buffer-slice-full-unit.log`.

Follow-up candidates (not yet validated as bugs): maximum-capacity enforcement
on buffer imports/restores, and compatibility of native buffer-method capture
with the Node >=18.18 root engine declaration. Keep these separate from slice;
reproduce each before changing code.

Final scoped TypeScript and ESLint passed. Actual harness passed after 70
uncached build tasks (61.666 seconds). Inspected
`screenshots/harness-run-docs-plans-safejs-array-buffer-slice.md.png`: clean
Harness passed output, expected result fields, zero spawns. This pair validates
runtime/schema integration, not model behavior.

# Frozen acceptance for a later separately approved prototype

No optimization exists in this report. Approval and a **different verifier** are
required before a production patch. This file specifies acceptance, not results
of tests that were not run. Do not silently broaden the proposed fast-path guards.

## Exact observed controls

Run both the approved prototype and the unmodified selected source against every
row of `workloads.json`, with its initial files, bytes, script and expected final
stdout/stderr/status/files unchanged. Its hash is in attempt-2/run-freeze.json.
All21 rows passed this report's unmodified/instrumented controls, not a prototype.

- Positive operation workloads: historical-sort-uniq-5000, plain-5000,
  unique-paths-20000, numeric-stable-8000, numeric-key-8000, in-place-5000, tiny-32.
  Preserve all recipes/bytes/effects. No timing thresholds during Curie load.
- Native controls negative-native-4/5/6: numeric fallback/reverse/unique, exact
  seed7 bytes; 28/29/30: folding, folded uniqueness and leading blanks;
  32/33: stable/unique whitespace-delimited numeric key; 34: NUL/binary ordering.
  Cached and bypass paths must preserve these frozen GNU9.7 observations.
- Golden negative-exact-numeric: >2^53 integers, negative integer, 20-place
  decimals, leading/trailing zeros, signed zero and stable ties. Leading `+` is
  not parsed as a sign by this parser; `1e3` has numeric prefix1, not1000.
- negative-check-duplicate: `-cnu` still detects numeric-equivalent duplicates,
  exact exit1/diagnostic/no output; check mode remains the uncached path.
- negative-missing-preserves-output: exact exit2/stderr and unchanged `kept` file.
  Never turn an input error into a cache error or publish sorted output early.
- negative-borrowed-10/0: nonzero-offset reused Buffer fragments, EOF mutation,
  exact LF/NUL bytes, unchanged backing VFS bytes. Retain collector ownership.

## Pinned wider acceptance, not rerun in this diagnosis

Use the files at **e090f29d9eb1aaf52eba08b2c2bf0aae53b9fb64**, not future live
versions. Existing test/native history stays intact. SHA256s:

| File | SHA256 |
|---|---|
| tests/commands/core-sort/native.json | `5bc9a663d8b3b161d4c8f56dffc5c920a7aaa993a7f67d36a87649768d5472f1` |
| tests/commands/core-sort/regressions.test.ts | `e5f65551496a365c86d0d92658650782d914049b19ec1d9cee654cb4b5905768` |
| tests/commands/core-sort/borrowed-buffer.test.ts | `8539cd88cea3e79a03d984febbba56afe7c2837dac0d3e54e948efacc05b8e81` |
| tests/contracts/io.test.ts | `0be30d243f4df7688f57fc2bdc5b7b914c3fae62203f8e5613595d4153e7f0ec` |
| benchmarks/reports/sort-performance-independent-20260827/hidden.mjs | `16f99c817b651ca6e7264fef89863f856f2282e7f321b5b2049e2a79ba165621` |

Require unchanged35 native observations (two original chunk widths), public
borrowed-Buffer tests, byte-contract tests and the corrected independent hidden30
controls at their documented profile. The hidden initial fixture failure remains
historical, not revived as a production requirement. Review helper adaptations
explicitly; do not label a modified harness unchanged. Native utility versions,
hashes, LC_ALL=C and Darwin host profiles in existing artifacts are binding;
captured GNU-on-Darwin is not native Linux/BSD proof. No new native campaign here.

Those existing cohorts cover precise numeric/multi-key behavior, binary and EOF
handling, empty records, source/cancellation/late rejection, exact32MiB admission,
zero publication on input failure, and output backpressure/ownership. Keep all
diagnostic assertions/statuses/effects; no blanket relaxations. Their old passes
do not certify a new prototype or this selected full source.

## Implementation-specific verifier obligations (pending)

- Keep parser syntax/normalization exactly: optional leading space/tab and minus,
  ASCII decimal prefix, no float/exponent/plus parsing, leading whole zeros removed,
  trailing fractional zeros removed, zero never negative. Preserve fraction
  padding comparison; do not introduce a separate rounding algorithm.
- Preserve key byte offsets and end inclusivity, explicit/whitespace field
  boundaries, empty/missing fields, key modifiers, and the existing rule that any
  key-local flags replace rather than merge the global flag set. Numeric reversal
  follows effective key flags; whole-line fallback follows global reverse.
- Preserve whole-record byte fallback when neither stable nor unique; preserve
  first-record stability/equivalence for `-s`/`-u`, including distinct byte strings
  with equal numeric values. Verify relevant options in actual Shell/registry.
- Proposal1 bypasses every explicit key, `b`, `f`, and check mode. Proposal2 admits
  exactly one numeric key without `b`/`f`; multiple keys and other modes bypass.
  Verify bypass with the pinned cohorts, not only direct comparator stubs.
- A verifier must freeze a small cap-focused extension before running it: empty
  records near entry cap, large numeric fields near logical character cap, cache
  saturation mid-sort, and guarded/bypassed cases. Exact bytes/status/effects must
  equal unmodified controls; over-budget entries use the original path rather
  than rejecting input. This is pending work, not a manufactured passing corpus.
- Use mutation/negative controls to ensure loss of exact precision, fallback,
  stable/unique semantics, cache admission and Buffer ownership is detectable.
  Do not remove source ownership copies or input/output limits for any gain.
- Numeric-stable should need at most8,000 cached parses if all entries fit;
  proposal2 numeric-key at most8,000 extractions/parses. Report actual counters,
  fallback/entry/character peaks and remaining padEnd/comparator counts. Do not
  convert theoretical counts into speed or total heap claims. Simple paths must
  not allocate descriptors; compare collection/output counters for regressions.
- Require abort/source-error/backpressure behavior and owned-work settlement
  unchanged. There is still no synchronous-sort preemption guarantee. No global
  cache or retained invocation/producer storage after completion.
- Only after correctness, frozen input integrity and independent verification,
  a root-authorized performance followup may measure under controlled load/order.
  Preserve all48 prior baseline mismatches as ineligible, the720 denominator and
  cold/public-adapter limitations. Do not infer a broad just-bash win.

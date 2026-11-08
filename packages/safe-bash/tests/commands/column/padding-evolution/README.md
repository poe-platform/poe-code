# Absent-tail padding profile evolution

This is a new root-authorized profile, based on the inspected column source tree
`014da3de0ca297c4e28bc410f908e94478edd40d` (the verifier's `38cb670a` tree), not a
restoration of author `e090f29d`. Initial observed live HEAD was
`01cc25f94247f6a2f9279f33c058fc4c7862f6ac`, later than root's reported HEAD.
Source/context/cancellation fixes from the verifier are authoritative.

## Behavior and algorithm

N01 now preserves three spaces after `9` and two after `22`, with unchanged
`z, alpha, b` row ordering. N03 emits `a  b  c  \n` and `d     e  \n`, including
the separator before the absent last cell on its first row. Explicit empty
fields, delimiter character sets, empty and multibyte output separators remain
distinct and supported. The final column's absent content has no width padding.
No sort, rectangular cells, new options, new limits or Unicode policy is added.

The layout stores only real input rows/cells. A single O(columns) suffix index
records capped byte totals and the next positive-output column. It includes
column width and separator bytes for every column before the final column.
Each short row combines its last actual cell's width gap with a suffix lookup.
The complete tail byte total is admitted against remaining output and charged
to cumulative work before allocating its bounded output buffers. The emitter
skips zero-output suffix nodes, so an empty separator/zero-width ragged table
does not incur a rows-times-columns scan. The saturated total (`maxOutputBytes
+ 1`) is solely a rejection sentinel. All stdout chunks are at most 8 KiB, with
awaited writes and no post-write mutation of retained buffers.

Actual rows/cells/fields and all existing numeric defaults remain unchanged.
Metadata charges column work; synthesized tail bytes charge work before output;
each output chunk charges a dispatch step. This can change the precise point of
a work-budget rejection from the old profile, while preserving the limit and
partial-output/cancellation contracts. An inadmissible suffix publishes none of
its padding; actual cells emitted before it remain. Later failures may preserve
an admitted padding prefix. Cleanup wrappers and shared input contracts are not
changed or reinterpreted.

## Evidence and intentional fixture changes

- `native-cases.json`: 14 bounded deterministic cases, at most 4 KiB each.
- `native-index.json`: authenticated pointer to the unique additive raw capture.
- `captures/native-tMviSP/observations.json`: 14 raw util-linux 2.41.2/Darwin
  observations, exact binary/version/environment/old-provenance hashes, and
  bounded process outcomes. N01/N03 replay identical sealed bytes.
- `profile-deltas.json`: old/new expectations for two existing canonical author
  assertions. The first evolution run was 111/113 because those assertions
  described the intentionally superseded omission profile. No old captured
  golden is edited. The prospective BSD selection now has 14 exact and 10
  qualified cases; its historical 15-exact classification remains recorded.
- `author-observations.json`: the new test's Buffer-vs-Uint8Array assertion
  correction is distinguished from profile evolution and implementation defects.
- `sparse-child.mjs`: five isolated product-only scenarios with 20,001 actual
  rows and 20,000 maximum columns (400,020,000 hypothetical rectangular slots),
  no rectangular allocation, and at most 60,000 actual cells. Empty separators,
  explicit empties and zero-width combining scalars succeed; output/work
  admission scenarios preserve exactly `x`. Allocations after publication are
  instrumented, output chunks are checked, and complete outputs are hashed.
  Each child has a 128 MiB V8 old-space setting, a 15-second parent deadline and
  64 KiB captured-output cap. These are safety checks, not performance/RSS parity.

Historical `tests/commands/column-stress/**`, native records, author captures and
reports are readonly. The literal old stress 37/40 result is not relabeled as a
new pass. Independent verifier holdouts are not read. No shared stdin assertion
waiver, cleanup fix, root/package/default integration, full gate, comparator,
provider claim or `du` work is part of this change.

## Reproduction

```sh
node --import tsx --test tests/commands/column/*.test.ts tests/commands/column/padding-evolution/*.test.ts
node tests/commands/column/padding-evolution/capture-native.mjs
```

Canonical tests only read committed records. Explicit native capture verifies
the existing pinned executable before and after use, and always creates a new
isolated `captures/native-*` directory with exclusive output files. Missing or
wrong-hash native binaries fail; no install/build fallback occurs. New captures
are not implicitly selected by tests. Native processes use small inputs only;
large ragged cases run solely against product code in bounded child processes.

The source README is the supported command profile. Final check/source seals and
the separate author handoff identify the committed candidate for a different
verifier; packed/public integration and any subsequent source edits belong to
that next assigned owner.

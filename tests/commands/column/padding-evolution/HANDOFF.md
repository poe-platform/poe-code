# Frozen padding-evolution author handoff

This column-only change evolves the verifier-authoritative source tree
`014da3de0ca297c4e28bc410f908e94478edd40d`, not the stale original author source.
The enclosing source/test commit is the coherent candidate; the subsequent
`source-seal.json` records its full commit and Git source-tree identity. After
that source/test commit, the author stops source changes for a different verifier.

## Result

- Immutable N01/N03 now exactly match the pinned util-linux absent-trailing-cell
  padding. No sorting, explicit-cell changes or separator reinterpretation.
- O(columns) capped suffix totals/positive-output links replace any need for a
  rectangular matrix. Zero-byte tails are O(1) per row; positive tails are bounded
  by admitted output bytes. Metadata/suffix work and output are checked before
  large allocation. All stdout writes are bounded at 8,192 bytes and awaited.
- Public factories, options, numeric defaults, scalar-width-v1, fill algorithms,
  dynamic context forwarding and cleanup sections remain unchanged. Canonical
  tests authenticate their exact prior source hashes. No shared-input assertion
  waiver, wrapper modification, root/package/default export integration or `du`.

## Exact checked candidate

Six-source-file digest:
`e4f9a8d1690600807d496ae8bc42409cc98344ee7bba10ea702a136d52cd370e`.
Full per-file hashes and the 220-entry source/input inventory are recorded in
`captures/verify-E4OZRb/verification.json`; SHA-256:
`a5a182d2a13293de51b16215b9b0e63240351bc68dc94b7c1bdd3c275db424be`.

Checks ran on live owned edits based on HEAD
`28f13113fcc57c60f90cf385f33ccc58db580a06`, with unchanged inputs during execution:

1. All owned canonical tests: **148/148**, zero fail/cancel/skip/TODO. This is
   113 existing tests (two prospective assertion selections evolved) plus 35 new.
2. Strict scoped NodeNext TypeScript over all owned `.ts` tests/helpers: passed.
3. `npm run build`: passed; no unrelated live build/type failure observed.
4. Direct built internal ESM N03 execution: passed, not packed/public acceptance.
5. Five additional isolated sparse-child repetitions: all completed as expected;
   three successful outputs and two expected budget failures preserving `x`.
6. Scoped whitespace check: passed; staged owned files are checked before commit.

Every explicit sparse-child repetition has a 15-second parent deadline and
128 MiB V8 old-space setting; canonical parent tests also cap captured output at
64 KiB. Actual RSS is recorded, not claimed to be bounded by the V8 heap setting.
The five scenarios use 20,001 actual rows and 20,000 maximum columns, but never
allocate or scan the hypothetical 400,020,000 rectangular slots. None is sent to
the native binary. `verify-5tbDqF` preserves an earlier passing source-identical
run whose standalone repetitions used the capture runner's 120-second deadline;
the final runner tightens them to 15 seconds and records deadlines explicitly.

The input audit re-enumerates matching source/test/helper/data names after checks
and detects additions/deletions, not only modifications to original entries.
Only the exact current generated JSON output directory is excluded from JSON
input enumeration; TS/MJS within it would still be audited. This is a scoped
live-input check, **not** a committed-archive or append-proof whole-repository
gate. The handoff/seal documents are added afterward and are not runtime inputs.

## Native and historical evidence

New capture: **14/14 selected exact native cases**, including N01/N03 and 12
small deterministic nonregressions. The capture also records one version probe.
Pinned binary SHA-256:
`a599976edf85eaa3222ac745309596023b5e63283a8b8ee3c3834d741214dd88`.
Profile: util-linux 2.41.2 built previously on Darwin, with inherited explicit
`en_US.UTF-8` environment. This is not a GNU/Linux locale/full-parity claim.
The binary identity is verified before/after use. No new native install/build.

Capture artifact: `captures/native-tMviSP/observations.json`; SHA-256:
`63830152f45f2e743b0d2ec0457d447983327af579ec4568be4297d494454e41`.
Original sealed N01/N03 recipes/native records and their byte hashes are checked
without edits. The old stress **37/40 remains literal historical evidence** and
was not rerun or relabeled. Fresh independent holdouts were not read.

`profile-deltas.json` preserves the old/new bytes for the two intentionally
evolved canonical assertions. Old author `cases.json`, native records, original
qualifications and reports remain unchanged. The prospective author BSD cohort
now has **14 exact / 10 qualified / 2 native-unsupported / 2 product-unsupported**;
its original 15-exact historical result remains recorded rather than overwritten.
`author-observations.json` separately records the one new harness byte-container
assertion correction. None of these changes relaxes shared stdin assertions.

## Ownership and process closure

Only owned column source/tests/docs/new evidence belong in the source commit.
Historical readonly inputs match their `38cb670a` bytes. Other workers' staging,
files, native artifacts and live changes are not included or removed. Every
native/sparse/check process observed termination; none is intentionally left
running. Unique captures are retained and canonical tests do not rewrite them.

No whole gate, comparison, full Unicode/native compatibility, deployed-provider,
packed standalone acceptance or public integration is claimed. The different
verifier receives source ownership after this author handoff. Subsequent source
changes require that assignment, not continuation of this author implementation.

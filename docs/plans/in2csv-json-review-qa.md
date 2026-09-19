# in2csv JSON independent review QA

Use the actual registered safe-bash commands with `MemoryFileSystem`; do not use
native processes in canonical tests. Reference-only differential capture uses the
hash-locked csvkit 2.2.0 environment under `out` with the frozen C/UTC profile.

1. Run `packages/safe-bash/tests/commands/in2csv-json-review.test.ts` after the
   maintained csvkit workspace build. Compare stdout, stderr and status exactly.
2. Exercise each measured JSON/NDJSON input both through a reused one-byte stdin
   producer and through a named virtual file. Check the named input remains byte
   identical and no other files appear.
3. Cover ordered object-field union, duplicate-key replacement, missing/null
   values, large integer/Decimal values under `-I`, empty array, required and
   missing top-level key, null policy, ignored common flags, NDJSON empty input,
   and rejected newline/key combinations using existing frozen observations.
4. Compare physical blank lines separately for borrowed stdin. LF yields
   `Expecting value: line 2 column 1 (char 1)`; CRLF yields the same line/column
   with char 2. Bare CR does not divide borrowed-stdin records and the measured
   two-object input yields `Extra data: line 1 column 16 (char 15)`. Named input
   normalizes all three separators and yields the LF diagnostic in every case.
5. With explicit `-e utf-8`, check a leading BOM yields the CPython diagnostic
   `Unexpected UTF-8 BOM (decode using utf-8-sig)` for both formats. The default
   input encoding is utf-8-sig, so rejection does not apply to the default.
6. Check named-file universal-newline normalization independently of borrowed
   stdin; named text and stdin must retain their distinct reference behavior.

The initial independent actual-shell run reproduced the BOM diagnostic mismatch.
The source decoder guard fixes that measured mismatch. Bare-CR stdin splitting
was also confirmed against the frozen executable and fixed by the root engine
owner. After the latest maintained workspace build, all 35 independent tests
passed with `TSX_DISABLE_CACHE=1`, including the 17 native typed-value observations
(reference indices 0–16) and the original zero-column Table warning case.

Nested flattening versus serialization is a requirements conflict assigned to
the root owner. Unnamed scalar, string and dictionary-iterable row headers are
qualified separately by the package suite with injected `columnWarnings.utilsPath`
deployment identity. Those cases are outside this independent measured cohort.
Zero-column Table warnings, including nonempty lists of empty objects, are
supported with injected frozen Agate package identity. An additional independent
actual-shell differential covers original empty-object case 5 with the warning
path derived from its frozen `from_object.py` diagnostic. Missing warning
provenance remains an explicit blocker.

This focused cohort does not establish all formats, stream cancellation, database
behavior, performance or the complete suite's release qualification.

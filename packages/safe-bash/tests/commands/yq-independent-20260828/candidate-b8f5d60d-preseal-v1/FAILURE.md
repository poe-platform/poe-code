# Stopped successor data inspection

Date: August 28, 2026. Admission: **DENY**. This packet is incomplete.

The one presealed own-data inspection exited 1 after 922 ms, before it read or
parsed the new source/package archives. Its process was reaped. Full stdout,
stderr, command and timing are preserved in `STATIC-CAPTURE.json`. There was no
retry, alternate artifact audit, extraction, materialization, repack, candidate
import/execution, compiler, type consumer, native oracle or harness cohort.

## Exact failure

`inspect-data.mjs:120` incorrectly equated the complete POSIX permission bits
of a historical working-tree file with Git's normalized regular-file mode.
The first mismatch is:

- Revision: `4b219eae180fcd2fd15ea864c9bc5226c54cda04`.
- File: `tests/commands/yq-independent-20260828/actual-35da1854-v1/raw-compound/COMPOUND-RESULT.json`.
- Git blob: `b2f438c6dac6d04ed1c2b71947cbb8ffc04256d8`; Git mode `100644`.
- Actual regular, single-link file: 64,460 bytes, POSIX `0600` (decimal 384).
- SHA-256: `f70f554c513e6a52c45496cf515c20cd796591c37e5eea2aa155e32fbac9f8a8`.

A single-entry diagnostic confirms its bytes equal the committed blob. The
original actual-review `FINAL-SEAL.json`, SHA-256
`c1d91e34da93ba6ee547e5d6fc9647ca7116bfbbcc731afda51a13790ac07321`, explicitly
seals this same path, SHA, size and mode 384. Therefore the failed assumption is
in this worker's new preservation check, not evidence of historical mutation or
a successor source bug. No file permissions were changed to satisfy the check.

The failed routine had authenticated the fixed commit objects and entered
historical snapshots. It had not reached new manifest-map reconstruction,
artifact SHA authentication, tar-entry checks, complete source/package comparison,
receipt generation or before/after completion. No successful `RESULT.json`,
`COMPOSITION.json`, full package map or admission receipt exists in this packet.
The prior source/build scopes were visited before the failing actual scope; this
is not promoted to a completed, persisted three-scope preservation result.

## Additive correction proposal — not executed

Keep the original inspector/preseal/capture immutable. A future separately
authorized data preseal can compare Git identity as blob/type/executable-bit
identity, while comparing complete POSIX modes against each immutable scope's
own original seal and a complete before/after filesystem snapshot. In particular,
Git `100644` does not require group/other read bits, whereas the original actual
seal already provides the exact `0600` expectation for this file. This is not
permission to normalize modes, omit captures, skip append checks or loosen
candidate tar/source/package `0644` requirements.

No corrected checker was written or run. Root must route any continuation and
its exact additive preseal; this worker stops under the sealed no-retry policy.
Fresh product execution separately requires complete future executor bindings
and an explicit root GO. The consumed 35da GO cannot authorize either a successor
product run or acceptance of this incomplete packet.

## Retained history

The original 409 whole-candidate refusal, all failed postprocessors, old 35da
build proof, actual 4b219 FAIL, CMD-22 path-domain mismatch and deadline-UNRUN are
not rewritten, rescored or rerun. The single diagnostic above verifies one
historical entry only; a completed fresh whole-scope before/after audit is pending.
No source, product, root, framework, private or other worker's file was modified.

# DOCX Office CLI verification — 2026-09-16

Verify the existing implementation against [the shared agent QA](office-cli-qa.md),
root/scoped instructions and the DOCX/shared CLI/SDK specifications. Preserve
unrelated work/index entries. No README edits, push, release, native document
runtime, implicit network or ambient document I/O.

1. Read all three contracts, both audits and complete inventories. Inspect prior
   receipts and original red/green evidence without rerunning implementation.
2. Build the maintained selected DOCX closure; manually execute built commands
   in an explicit `/work` MemoryFileSystem with original small inputs, limits and
   fixed timestamp. Record exact outputs under `docs/docx`.
3. Extend the prior Q04 setup with styled split runs, a hyperlink and excluded
   header text. Reopen outputs and compare each admitted part's SHA-256.
4. Inspect maintained terminal-renderer screenshots of help, edits, selection
   and schema errors. No saved runner or screenshot test suite.
5. Reduce a newly observed usability defect to an original failing memfs test
   before code; run focused and maintained scoped tests/lint/build, then probe
   the fresh build in a new process and inspect its screenshot.
6. Stage only the correction, its original test, this procedure and linked
   evidence. Commit one atomic Conventional Commit on main, without bypasses.

## Q33 validated reduction

Fresh built no-match replacement returned exit 1 with null data, zero effects,
empty locations and only `Document operation failed: missing-selection`.
The original `text-match-guidance.test.ts` failed both human/JSON variants before
code: missing `--find` and nested help guidance. Status, input preservation and
failure-envelope assertions passed before those failures.

Add bounded recovery guidance only for `text.replace` missing-selection:
review find/scope/selection, consult nested help, and use allow-empty only for
intentional no-match results. Do not assert that every missing-selection error
means absent literal text. Keep SDK error categories, matching, cardinality,
publication, other operation diagnostics and raw-data privacy unchanged.

The [verification receipt](../docx/office-cli-verification-20260916.md) records
fresh observations, retained red/green logs and gaps. The baseline interactive
session keeps old module dependencies; it is never post-fix evidence. A separate
fresh process verifies the corrected built engine.

Verification settled: focused checks passed four files/44 tests; maintained DOCX
tests passed 225 files/4,967 tests without skips. Scoped lint passed with its
existing type-only-variable warning. The selected five-build closure and its
postbuild export checks passed. Fresh built Q33 remains exit 1 with null data,
zero effects and empty locations; its corrected screenshot was inspected.
Thirty-five bounded built probes and unrun variants are retained in the receipt.

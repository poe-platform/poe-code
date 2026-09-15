# DOCX built-command usability QA

Scope: execute [the paired agent procedure](office-cli-qa.md) for DOCX only.
Shared CLI/SDK and DOCX specifications govern behavior. Later model, corpus,
native-rendering and counterpart implementation tasks remain pending. Evidence
belongs in `docs/docx`; no README edits, push or release.

## Agent procedure

1. Read root/scoped instructions, contracts and complete retained inventories.
2. Build the selected DOCX workspace closure. Exercise commands interactively
   through built Shell with a rooted MemoryFileSystem and explicit limits.
3. Author tiny independent inputs through public SDK operations; reset mutations
   to their originals. Inspect semantic text, part bytes, image hashes and JSON.
4. Inspect help/error/edit screenshots using maintained screenshot tooling.
   No saved QA runner or screenshot suite replaces these agent observations.
5. Reduce reproduced usability defects to focused original tests. Observe failure
   before changing code, then run maintained scope verification and inspect output.
6. Commit atomic improvements on main, explicitly staging owned paths only.
   Retain unrun/blocked cases and historical evidence without claiming parity.

## Legacy command recovery

Built Q41 returned usage 2 with only `Unknown document command path.` Four
original focused cases in `legacy-command-guidance.test.ts` failed before code:
image, table, metadata and replace lacked their supported replacement paths.
The parser now retains rejection and recommends images, tables, properties or
text replace, plus root help. Unknown paths recommend root help. No input wording
is echoed and no document handler or stdin acquisition runs.

Verification: focused grammar suite passed 62 tests; maintained DOCX test route
passed 174 files, 3,430 tests with four skips. Maintained scoped lint passed with
one existing type-only-variable warning; selected build closure passed. Screenshots
before/after are disposable QA evidence; no binaries are committed.

Remaining execution accounting and exact mappings will be recorded in the
DOCX execution receipt after the remaining available recipes are inspected.

## Diagnostic recovery

Built Q32 exposed only the stale-selection code; Q47 exposed only `Invalid
option value.` Two original tests failed before code in
`command-recovery-guidance.test.ts`. Invalid direct flag values now name the flag
and its valid nested help route without echoing the supplied value. Generic stale
selection diagnostics advise inspecting again and selecting a fresh location;
the existing diagnostic byte bounds still apply.

Verification: focused grammar/inspection checks passed 71 tests. Maintained DOCX
tests passed 175 files, 3,432 tests with four skips; scoped lint and the selected
build closure passed. Inspected maintained screenshots of the flag error and
stale diagnostic formatter. The formatter screenshot uses its internal built
module, not a promised public export; the initial wrong-import capture is a QA
setup error, not a product API defect.

## Root help usability

Two original root-help tests failed before code: common flag-based examples were
absent from the introduction and the longest line was 538 characters. Root help
now starts with ordinary workflows, lists every direct path with its actual
read/edit/reject label, and routes detail to nested help. It uses the maintained
140-character wrapper. Structured help still covers all 1,517 declarations;
no unsupported public model member is removed.

Verification: focused discovery checks passed 33 tests; maintained DOCX tests
passed 176 files, 3,434 tests with four skips. Scoped lint and the selected build
closure passed. Inspected the maintained built root-help screenshot. Only the
owned root-help hunk is staged from discovery.ts; its unrelated packing and
capability edits remain uncommitted.

## Extraction failure envelope

Q10 rejected an incapable adapter before publication but returned a planned
manifest and locations without partial-output consent. The original focused
`image-extraction-failure-envelope.test.ts` failed with that non-null data before
code changed. Prepublication failures now return null data and empty locations;
explicit partial-output consent and actual published receipts retain manifests.
No input, sentinel or destination is changed by the rejected command.

Verification: focused extraction checks passed 20 tests; scoped lint and the
selected maintained build closure passed. A fresh Node process executed the built
engine with original rich input bytes through explicit stdin: exit 3, null data,
zero affected and empty locations. Its maintained terminal-renderer screenshot
was inspected. A cache-busted index import in the existing REPL still retained
its baseline dependency modules and was discarded as post-fix verification.
Maintained DOCX tests passed 177 files, 3,435 tests with four skips.
Final execution accounting is in the [receipt](../docx/office-cli-execution-20260915.md).

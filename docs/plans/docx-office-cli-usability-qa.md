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

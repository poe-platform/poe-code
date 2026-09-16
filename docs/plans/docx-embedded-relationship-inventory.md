# Embedded relationship inventory prerequisite

Scope: small prerequisite discovered during the explicit-sanitization task;
no later task is started. Date: 2026-09-15.

An original memfs package with an inert embedded leaf and its empty `.rels` part
reproduced a failure: the object inventory's embedding-folder heuristic treated
the relationship part as an embedded object, then tried to traverse relationships
owned by relationships. The independent `objects.test.ts` regression failed with
`Relationships cannot own relationships` before the code change.

Exclude admitted relationship content types from the orphan embedding candidate
heuristic. Retain all payload candidates, physical object owners and package
relationships. No external input, runtime, download or networking is needed.

This is a package inventory classification fix, separate from the new sanitize
editor and its owned empty-sidecar collection. Public model inventories and all
later tasks retain their existing status. Maintained package checks and selected
build closure are recorded after final validation.

Validation: the original independent test failed before the one-condition fix.
The maintained DOCX suite passed 146 files / 2,996 tests; final focused checks
passed 63 tests, including the 21-test original object suite. Package lint and
both TypeScript projects passed (one unchanged existing warning), and the selected
five-stage maintained DOCX build closure passed. Existing actual Shell adapters
passed 151 tests without skips. The final suite rerun includes the subsequent
sanitization input-type regression; its result is recorded in the task plan.

Final maintained suite on the completed source/test state: 146 files / 2,997
tests passed. This prerequisite is committed separately from selective sanitization.

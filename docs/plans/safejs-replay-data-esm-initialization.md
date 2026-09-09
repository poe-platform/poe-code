# Replay-data standalone ESM initialization

## Validated issue

Importing built `snapshot/replay-data.js` before the SDK throws
`ReferenceError: Cannot access 'MAX_DATA_DEPTH' before initialization`.
Snapshot validation eagerly copies the imported graph-depth constant at module
initialization, closing a cycle through interpreter modules.

This is independent of the unfinished Temporal integration. A clean archive of
commit `d1eb8dc29` at `/tmp/safejs-replay-init.fNTLBZ`, with only the new fresh
process regression added, reproduced the failure (25e517): four existing
import checks passed and the standalone replay-data check failed. The archive
uses the existing dependency installation via a node_modules symlink; SafeJS
sources and generated output are local to the archive.

## Change

Read the original `MAX_DATA_DEPTH` binding inside the existing validation-limit
functions instead of copying it at module initialization. Neither the limit nor
the budget behavior changes. Keep the standalone import and primitive round-trip
check in the maintained postbuild tests, using a fresh native ESM process so
prior imports cannot mask the cycle.

## Verification and delivery

The isolated candidate's focused replay-data, descriptor-validation and
heap-validation tests passed: 41 cases in three files (e3a1d9).
The maintained selected workspace build passed 23 tasks and five fresh native
ESM checks (1a1b84). All five checks also passed on minimum Node 18.18.2
(b981b9). The candidate validation implementation matches the working-tree file
byte for byte (1c5872).
Restore and serialization checks also passed all 97 cases (69f3be), including
nesting/depth-limit regressions: 138 focused cases total across five files.
Scoped ESLint completed successfully on the isolated candidate (409134).
This change has no CLI rendering impact. It does not claim full-package or
JavaScript conformance. Publication remains on hold; do not push this commit
while a main push automatically releases.

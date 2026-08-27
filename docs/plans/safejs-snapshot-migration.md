# Explicit SafeJS checkpoint migration

Status: implementation and local validation complete; published-consumer verification pending.

## Contract

Migration is an explicit continuation boundary, not an AST/hash/version rewrite.
The application supplies new source and deliberately selected application state.
The new source reads that state through `import.meta.migration`. No old frames,
callbacks, promise jobs, imports, or host operations execute during migration.
The new source starts at its entry; old effect history is archived, not replayed
against an unrelated program. Its own effects are subsequently checkpointed and
replayed normally. Deliberately repeating an operation in the new program is the
application's responsibility, not an exactly-once guarantee from migration.

The input must be a portable, validated format-1 dump with a complete version-1
host replay journal. Supported older execution markers can cross this boundary
without running an old interpreter. Unknown formats and incomplete effect
histories fail closed, rather than assuming missing effects did not happen.
Ordinary restore continues to enforce source and execution-semantics pinning.

Inspection verifies the original source, snapshot envelope, replay identities,
consecutive call ordinals, outcomes, and existing migration ancestry. It returns
a deterministic SHA-256 checkpoint digest and all unresolved/cancelled host calls.
Digest calculation ignores object key order, not values or array order.

Every migration requires a host receipt for that exact digest asserting that the
original execution, external operations, and callbacks are quiescent. This is an
explicit trusted-host assertion: the runtime cannot stop another process or
authenticate a business-side transaction merely by examining JSON. Every
unresolved/cancelled call additionally needs exactly one resolution, including
re-issuable reads. A resolution records either a reconciled outcome or confirmed
non-performance. Missing, duplicated, unrelated, and stale receipts fail closed.
Inspection and migration never invoke host capability or replay hooks.

State is portable data, not a live closure, promise, or generator. Migration
preserves its graph through the existing replay codec. The output archives each
predecessor's source identity, checkpoint digest, execution marker, complete call
journal, and reconciliation receipt. Ancestry is retained across success,
failure, budget exhaustion, checkpoint serialization, and further migrations.
No prior file is overwritten by the migration command. An exclusive output file
is created only after validation and serialization; failure leaves inputs intact.
CLI file inputs are `.ajs` executable source files, including paired harness
scripts. Existing standalone `--restore` and paired `--resume` run the output.

## Delivery and validation

1. Add failing SDK tests for edited source, older execution semantics, repeated
   transitions, failures/budgets, invalid state, journal corruption, receipt
   identity, outstanding effects, and no host re-entry.
2. Implement inspection/migration in SafeJS, preserve metadata in run/restore,
   and expose equivalent standalone/root CLI and SDK workflows.
3. Add in-memory file/CLI tests for atomic publication, no overwrite, malformed
   plans, source selection, and actionable diagnostics.
4. Stress varied scripts and real killed processes, including migrations after
   completed, failed, and externally reconciled effects; compare new-source
   results with native JavaScript where applicable. Exercise all entry forms,
   repeated restore/migration, corrupt data, and concurrent independent runs.
5. Run focused/full tests, build, types, lint, CLI screenshots, packaged consumer
   scripts on supported Node versions, and stale-output inventory checks.
6. Commit the completed item, push, monitor release, and verify exact published
   package/tag identity plus fresh installed consumers. Record actual evidence
   and limits in the language-completeness checklist before marking it complete.

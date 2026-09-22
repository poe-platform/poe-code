# csvsort wiring prerequisite verification

Status: command-csvsort remains blocked on accepted CSV engine contracts.

Inspected the current working tree on 2026-09-20. Unlike the historical
behavior review, `packages/safe-bash-command-csvsort` now exists. Its manifest
is private, TypeScript ESM, named `safe-bash-command-csvsort`, with no runtime
dependencies. Its public source exports only `sortRecords`, `CsvSortError`
and admitted-record sorting types. There is no CommandDefinition, plugin,
byte-stream CSV SDK, parser, selector, serializer or whole-column inference
implementation in that package. Its README explicitly identifies these gaps.

`npm run test:unit --workspace=safe-bash-command-csvsort` passed all ten tests.
These verify admitted text/integer sorting, stable reverse ties, null ordering,
ownership, quotas and cancellation. They do not qualify CSV parsing, Decimal
context, Boolean/temporal inference, invocation I/O or CLI/SDK equivalence.
No sorting defect was reproduced and no sorter changes were made.

The safe-bash manifest has neither a `./commands/csvsort` export nor a
`safe-bash-command-csvsort` dependency or qualified workspace profile. Source
path searches found no accepted shared CSV engine workspace. The existing
engine and behavior prerequisite findings remain applicable to parsing and
inference, although their historical statements that the command workspace
does not exist are superseded by this inspection.

The command plan states at line 266: "prerequisite plans must pass their stated
acceptance gates before dependent integration." Its engine task requires the
shared CSV parser and selector contract. The package-pattern instructions are
available at [the archived path](archive/safe-bash-command-package-pattern.md);
the unrelated move was preserved. XAN CSV, selector, sort and writer paths are
held in `packages/safe-bash/integration-boundaries.json`. No held implementation
was opened, extracted or imported.

Required prerequisite acceptance covers original bounded byte-stream parsing,
selectors, comma/LF serialization and whole-column inference, including the
QUOTE_NONNUMERIC float provenance, precision-28 Decimal, Unicode and explicit
temporal capability profiles in [the acceptance matrix](safe-bash-csvsort-acceptance.md).
Only then can wiring TDD exercise real CommandDefinition and SDK execution,
literal VFS operands, argv grammar, awaited sinks, signals, cleanup and budgets.
Qualified build integration must then verify isolated installed runtime/type
consumers without private workspace dependencies or duplicate contract brands.
Default registration must remain unchanged.

This task added only this evidence document. No placeholder command, reduced
compatibility profile, runtime export or build-policy bypass was introduced.
CLI screenshots and packed-consumer checks remain unexecuted because there is
no CSV command to exercise. Unrelated changes were preserved. Local commits,
remote-main delivery and successful releases: none. Nothing was published.

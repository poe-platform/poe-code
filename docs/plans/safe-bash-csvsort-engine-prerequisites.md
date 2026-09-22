# csvsort engine prerequisite finding

Status: blocked on the shared CSV parser and selector contract; engine-csvsort
is not implemented.

Repository inspection on 2026-09-20 found no admitted shared CSV parser or
column-selector workspace. Package-manifest and source-path searches found the
XAN CSV/selector paths, a Pandoc document-format reader, and an ExifTool CSV
serializer, but no accepted shared contract for csvsort to consume. This is a
missing prerequisite, not a reproduced csvsort runtime defect.

`packages/safe-bash/integration-boundaries.json` explicitly holds
`src/commands/xan/csv.ts`, `selector.ts`, `sort.ts`, and related modules.
`packages/safe-bash/tsconfig.build.json` also excludes the XAN CSV implementation.
No held source was read, imported, extracted or admitted during this inspection.

The requested `docs/plans/safe-bash-command-package-pattern.md` is deleted in the
working tree; its available archived successor at
`docs/plans/archive/safe-bash-command-package-pattern.md` was read without
restoring or changing either path. It requires shared parsing in narrowly scoped
private engine packages and an acyclic engine/contracts → command → safe-bash
dependency graph. `docs/plans/safe-bash-csvsort.md` requires prerequisite
acceptance before dependent integration. The acceptance specification likewise
identifies shared CSV/inference admission as a prerequisite, not permission to
bypass the XAN boundary.

To unblock this task, first establish and accept an original first-party shared
CSV parser and selector contract, or complete the existing admission gates for
a reusable implementation. The contract must expose byte-stream parsing,
versioned dialect/quoting/decoding and structured errors, selector ordering and
indexing, explicit cancellation, invocation cleanup and bounded accounting.
It must distinguish the admitted QUOTE_NONNUMERIC float path from ordinary
string cells so inference does not erase input-quoting semantics. Shared
serialization must specify comma/LF output and embedded-CR conversion.

After acceptance, write original failing csvsort engine tests against those
APIs before implementing whole-column inference and stable sorting in
`packages/safe-bash-command-csvsort`. Cover the independently specified Boolean,
null, precision-28 half-even Decimal, scale/negative-zero, leading-zero,
mixed-type, Unicode code-point and temporal cases from
`safe-bash-csvsort-acceptance.md`. Temporal grammar, reference clocks, century,
timezone, locale and unavailable capabilities need explicit supported profiles
and errors rather than ambient Date parsing. Include grammar/error/chunk,
cancellation and exact-limit controls before any compatibility claim.

The command package must remain private with no external runtime dependencies;
safe-bash must compose/export its API at `commands/csvsort` and bundle both
implementation and declarations. Isolated packed runtime/type consumers must
verify that no unpublished workspace is required. CLI/SDK parity and artifact
verification remain unexecuted acceptance work.

No scaffold, substitute CSV engine, placeholder failing test, runtime export,
manifest or build-policy change was introduced. No native oracle, runtime test,
packed-consumer verification, commit, push or publication was performed.
Unrelated edits were preserved. The task remains open.

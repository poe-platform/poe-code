# csvstat engine prerequisite finding

Status: blocked on missing shared contracts; engine implementation is incomplete.

Repository inspection on 2026-09-20 found no admitted shared CSV parser,
column-selector or whole-column inference workspace, and no csvsort inference
implementation to reuse. Source-file and workspace-manifest searches found no
shared Decimal engine implementing the required precision-28 half-even contract.
The csvstat task explicitly depends on those contracts and prohibits duplicating
shared engines. This is a missing prerequisite, not a reproduced runtime bug.

The existing XAN CSV and selector paths are explicitly held in
`packages/safe-bash/integration-boundaries.json` and excluded in
`packages/safe-bash/tsconfig.build.json`. They were not read, imported or extracted.
`packages/pandoc/src/formats/csv.ts` registers a document-format reader; it does
not expose the required CSV selector or inferred-value contracts.

The requested package-pattern document is deleted in the working tree. Its
available archived successor at
`docs/plans/archive/safe-bash-command-package-pattern.md` was inspected without
restoring or altering either path. The existing csvstat acceptance specification
also leaves shared inference engine admission open.

To unblock engine-csvstat, provide admitted first-party shared parser, selector
and inference implementations with versioned byte/quoting/error contracts,
typed Decimal and temporal identities, explicit locale/calendar/clock
capabilities, cancellation and resource accounting. Their APIs must support
exact aggregation and representative-value identity without rounding values
through JavaScript Number. Then write original failing csvstat engine tests
against those contracts before implementing aggregation, argument parsing and
safe-bash artifact exports.

No command scaffold, substitute parser/inference engine, failing placeholder
test, export, build-policy change or package publication was introduced. No
runtime compatibility or packed-consumer checks can be claimed from this
inspection. Unrelated working-tree changes remain preserved.

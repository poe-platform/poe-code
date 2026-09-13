# Value-axis crossing semantics

The [exact case receipt](axis-crossing-case-map.json) reviews all 14 crossing unit
variants and 17 expanded crossing BDD examples in the pinned research inventory.
Their parameter values are covered by 58 original cases in both XML dialects.
The existing standalone `packages/pptx/THIRD_PARTY_NOTICES.txt` retains the MIT
notice; no source-project identities or assets enter product code or tests.

Two defects were reproduced: assigning `CUSTOM` left a predefined crossing
unchanged instead of installing numeric zero; reading after removal returned
`AUTOMATIC` instead of `CUSTOM`. The corrected implementation changes only the
crossed axis identified by `crossAx`. Existing custom coordinates remain intact.
The prior model test incorrectly expected automatic mode after null removal;
that assertion now follows the reviewed contract.

## Exact JavaScript and command mappings

| Public member | JavaScript behavior | Command mapping |
| --- | --- | --- |
| `ValueAxis.crosses` | Synchronous getter/setter using `XL_AXIS_CROSSES`; absent predefined crossing reads `CUSTOM`; assigning custom retains an existing coordinate or installs zero | `charts set --objects` record `{target:"valueAxis",crosses:"CUSTOM"}`; all registered crossing symbols remain admitted |
| `ValueAxis.crosses_at` | Synchronous `number \| null` getter/setter; null removes both crossing alternatives; finite numeric values retain their value | Same record with `crossesAt:number \| null` |

These are live owner mutations, not detached records. No host I/O, clock, native
runtime, dependency mock topology or arbitrary JavaScript execution is involved.
Read-only SDK getters do not create nodes. Command inspection retains its
noncreating path; CLI mutation shares the domain model and validates before
publication. Property spelling remains neutral snake_case, while typed command
records retain the shared camelCase option contract. Invalid enum/numeric inputs
continue through the existing typed validation. XML may serialize numeric zero
as `0` rather than `0.0`; these are the same numeric value.

The two members remain publicly documented even though older research inventory
rows describe them as unimplemented. This receipt supersedes those historical
labels only for these members and cases. See the [verification plan](../plans/pptx-axis-crossing-reconciliation.md)
and [CLI receipt](../plans/pptx-chart-crossing-cli.md).

## Remaining scope

This does not reconcile every axis, series, point, plot, legend, data-label,
workbook, deck, notes, media, action or core-property variant. The earlier
`chart-live-graph-cases-20260913.json` family links explicitly lack exact parameter
certification; those unresolved rows must not be counted as implemented parity.
The authoritative `test-case-map.json` retains all 3,673 source identities and
their individual adaptation obligations. Every remaining row needs payload
review and original assertions, or an explicit unsupported edit regression plus
a follow-up requirement. Existing API ledgers retain inherited members,
underscore-prefixed documented types, enums and APIs without source tests.
No whole-public-API or full-format completion claim is made.

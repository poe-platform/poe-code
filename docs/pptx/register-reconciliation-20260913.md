# Presentation register reconciliation

This documentation receipt reconciles the retained research registers on
2026-09-13. It does not certify whole-public-API coverage or rendering fidelity.
The [format contract](../specs/pptx.md), [shared CLI](../specs/office-cli.md)
and [shared SDK](../specs/office-sdk.md) remain authoritative.

## Accounting and corrected drift

The [test inventory](upstream-test-inventory.json) contains 2,700 collected unit
variants and 973 expanded BDD examples. Each resolves to exactly one original
TypeScript adaptation row in [the case ledger](test-case-map.json), retaining its
source identity, parameter evidence and disposition. No parameterized test or
BDD example was collapsed or removed in this change.

The ledger's current target statuses are 2,585 semantic reviews required, 43
original TypeScript passes recorded, 167 specified but not implemented, 877
proposed designs and one deferred public behavior. These are central-ledger
labels, not a fresh execution census: later family receipts can supply narrower
evidence without updating every historical row. The historical test audit's
“adaptation not started” status describes its baseline, not the current package.
Reserved case IDs and candidate matches are not passing evidence.

The [API inventory](upstream-api-inventory.json) now contains 2,409 records; all
have destinations among 2,426 [target API rows](public-api-map.json). The extra
17 rows are bounded XML/package view members. The case ledger still counted
2,407 inventory records and 2,424 targets and omitted two acceptance obligations.
This change appends those obligations and corrects the totals. Existing rows,
source hashes, historical execution claims and source identities are retained.
The 1,072 targets without prior class/workflow candidates remain visible; absence
of candidates does not remove their independent original-test obligation.

The two appended obligations reference existing original cases
`freeform-live-x-offset` and `freeform-live-y-offset`. Both use the same original
test with separate x/y assertions: start at (12,18), move to (20,30), then add
(-5,-7). The getters change from 12/18 to -5/-7. A previously returned move
operation applies at (25,37) using current bounds. Sharing this test is justified
by these distinct assertions, not by similarity of names. It does not establish
equivalence for every source parameter variant.

## Exact mapping and scope

`readonly shape_offset_x: Length` and `readonly shape_offset_y: Length` are
synchronous direct properties recomputed from live local bounds, including the
initial point and move/line endpoints. They return immutable unit values and
perform no host I/O or mutation. Neutral model spelling is retained; these are
not new camelCase aliases. Their [member receipt](adjustments-freeform-evidence-20260913.md)
and register preserve J01/J02/J05/J08/J09/J10 language/security mappings, typed
failures and bounded path capabilities. This receipt adds no command route.

The [language mapping contract](api-language-mappings.md) also governs inherited
members, enums, collections, helpers and returned underscore-prefixed interfaces.
None is excluded by spelling or lack of upstream tests. CLI resource names remain
plural (`images`, `tables`, `properties`); literal replacement remains
`text replace`. Common selectors, flags, JSON, exit statuses, `schema` and
`capabilities` remain governed by the shared contract, not source naming.

Research provenance remains in these research registers. Existing derived
research remains covered by the [standalone MIT notice](upstream-license-notice.txt).
No source implementation, wording or assets were copied into product files.

## Evidence limits

Node v22.23.2 and Vitest 4.1.11: the existing
`packages/pptx/src/freeform-builder.test.ts` passed all seven cases, including the
explicit live-offset assertions. This is bounded SDK evidence, not whole API,
CLI-route or rendering acceptance. No new product regression was needed for the
documentation omission.

No corpus fixture was downloaded, edited, rendered or shipped. No renderer or
font configuration was exercised, so visual features and font fallback are
unassessed by this receipt. Disposable fixture policy remains in the
[corpus manifest](corpus-manifest.json); future paired visual checks and original
regression reduction are specified only in the [agent plan](../plans/pptx-register-reconciliation-20260913.md).

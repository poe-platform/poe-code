# Zero-axis connector grouping evidence

The grouping engine rejected horizontal, vertical and coincident-endpoint
connectors because every child needed positive width and height. Valid connector
endpoints can have a zero axis. The engine now admits those connector extents
while requiring positive group union dimensions. Negative or missing connector
dimensions, singular unions and zero-sized ordinary shapes still fail before
publication. Identity ungrouping preserves the original connector XML.

`shape-group-degenerate-lines.test.ts` contains ten original cases: three valid
zero-axis variants, three singular unions, two negative extents, a combined
missing-value/ordinary-shape rejection case, and one public SDK/CLI parity case.
The parity case creates two connectors at explicit negative/nondefault origins,
groups them through `groupShapes` and `shapes group`, and independently asserts
the union `(-17, 23, 117, 247)` and each child's stored dimensions. The isolated
domain cases also assert explicit slide-space corners and preserved markup.

The public mapping stays asynchronous for binary operations, with explicit
`Emu(0)` tolerance and explicit byte input. CLI uses plural `shapes`, the existing
location-array selector, `--tolerance 0emu`, `--in-place`, and `--json`. Unit I/O
exists only through supplied memfs callbacks. No ambient files, process/native
runtime or network are introduced. This does not add a new public model alias.

Research context: `upstream-test-inventory.json` retains the four
`tests/oxml/shapes/test_groupshape.py::DescribeCT_GroupShape::it_calculates_its_child_extents_to_help`
parameter rows and the two recalculation rows. Existing
`shape-groups.test.ts` covers the positive-box union parameter values. This new
regression supplements those with independently authored zero-axis connector
bounds; it does **not** claim each positive-box, empty-tree, or recalculation
source row is behavior-equivalent to these new tests. Existing connector endpoint
parameter obligations remain in their ledger; this change does not replace them.
The six `features/shp-groupshape.feature` scenarios (lines 7, 12, 17, 22, 30,
39) concern click actions, type, child collections and live zero/one/two-child
extent recalculation. None is reclassified as covered by this operation-level
regression. `features/shp-shapes.feature:34` concerns the live collection's
connector insertion, also distinct from grouping existing selected siblings.
The public inventory's inherited `Connector.width`/`height` and `GroupShape.shapes`
obligations remain visible and are not reclassified based on type spelling.

No reference implementation, fixture or assertion wording was copied. Existing
standalone research notices remain the legal provenance authority. Crop and
font fitting are outside this bounded fix; neither is erased or relabeled as
layout-engine-only. This is not a whole drawing API/test completeness claim.

TDD: three expected failures preceded the production change. Focused validation:
five files, 83 passing tests (new boundaries, group domain, transforms, group
commands and connector model). Root delivery records maintained package checks
and local commit separately.

Owned-file ESLint and whitespace checks passed. The maintained package lint run
reached test typechecking and reported missing `archiveLimits` in the concurrent
text-fit boundary test; the coordinating agent received the exact diagnostics
for repair and rerun. No diagnostic referred to this change's files.

# Connector creation, binding and preservation

## Authorized scope and ownership

Implement bounded connector behavior in `packages/pptx`; safe-bash integration
belongs in `packages/safe-bash/src/commands/pptx`. Root only wires public APIs.
The SDK worker owns domain source/tests, the CLI worker owns operation/schema
source/tests, and the audit worker owns this plan and new connector research and
usage documents. No whole pipeline execution, README edits, push or release.
Commit each verified atomic improvement on main, explicitly staging owned files.

Authorities: `docs/specs/pptx.md` F26 and connector operation appendix,
`docs/specs/office-cli.md`, `docs/specs/office-sdk.md`, root/scoped AGENTS.
Research baseline: pinned test/API audits and inventories under `docs/pptx`;
connector receipts retain source identities only in research. Existing standalone
license notices remain required for derived research material.

## Acceptance work

1. Reproduce missing connector creation/binding behavior with original fast tests.
2. Create straight/elbow/curved connectors with safe unique IDs and explicit free
   endpoints. Reject invalid sites/owners/IDs before any published mutation.
3. Attach/rebind both ends to existing object IDs and valid connection sites;
   maintain the distinction between attached endpoints and free coordinates.
4. Validate all flipped/unflipped getter and setter branches, including crossing
   endpoints; preserve geometry beyond supported presets and adjustments.
5. Define explicit detach/remove before target deletion; preserve complex timing
   references and reject unsafe reference changes. Include nested groups and ID
   collisions throughout the owning drawing, not only immediate siblings.
6. Exercise public SDK and CLI, typed schemas, capabilities, selectors, errors,
   dry-run/publication, and independent serialized-XML assertions using memfs.
7. Keep every relevant parametrized/BDD row in connector case accounting and
   every inherited/public/enum member in API accounting, with honest remaining
   model gaps. Operational analogues do not prove a live Presentation graph.
8. Run relevant maintained checks and inspect command help/error screenshots.
   Commit only after passing checks; root reports each local hash separately.

## Disposable corpus QA procedure

Use only existing files named by `docs/pptx/corpus-manifest.json`, verify SHA-256
before inspection, and never stage corpus binaries or generated output. Units
must use original in-memory fixtures and must never depend on this corpus.

The cached manifest reports five connector-bearing documents: 3, 2, 741, 10 and
58 connector nodes respectively. Prefer the small first document for byte-level
retention; the second document includes nested groups. Census counts include
masters/layouts and do not assert editable slide-local coverage.

After the implementation is available, explicitly read an admitted cached file
into bytes, inspect connectors through the public SDK, and inspect serialized
connector XML independently. If editable, make one bounded endpoint/binding
change in memory, reopen the result and verify target IDs/sites and untouched
unsupported geometry. Otherwise record the precise supported boundary. Reduce
any meaningful failure to a tiny original memfs regression; do not retain source
assets in tests. Root owns the visual CLI screenshot procedure.

## Evidence

- Initial read confirmed all five manifest-listed connector-bearing cached files
  exist. No downloads performed.
- Direct inventory selection retains 58 unit variants and 11 BDD examples.
  Another 69 neighboring/inherited base-shape rows remain individually visible.
- API receipt retains 41 connector, inherited-member, collection-add, and enum
  records. Detached XML views do not satisfy live model ownership/collection APIs.
- Maintained integration results and terminal QA are recorded in
  `docs/plans/pptx-connectors-integration.md`.

### Original regression and corpus receipts

The additional audit-owned test file is
`packages/pptx/src/connector-behavior-cases.test.ts`. It checks every coordinate
getter/setter branch with literal independent XML offset/extent expectations,
four creation quadrants, cardinal sites and original picture attachment/rebinding.
A failing test confirmed midpoint double rounding through a fractional group:
a width-one target scaled by 6/10 has a top-site x of 0.3 EMU, which rounds to 0;
averaging already-rounded corners incorrectly yielded 1. Projection now happens
before final rounding. This is an original tiny in-memory regression.

SHA-256 matched the manifest for all five connector-bearing cached files. SDK
inspection of the first template returned zero slide-local connectors despite
its census of three across all drawing scopes. SDK inspection of the second
fixture returned two free connectors, on slide4 and slide16, both using
`straightConnector1`. An in-memory line-color mutation reopened with both presets
and all attachment metadata retained. This alternate preset was reduced to an
original one-connector geometry-retention regression, with no source asset reuse.

Independent corpus package/XML comparison found only `/ppt/slides/slide4.xml`
changed after the color update. All connector `xfrm` and preset geometry markup
in that slide remained byte-identical. The archive's name iteration order changed;
no order-invariance claim is made. No QA output files were written.

The final original suite now also exercises all endpoint getter/setter branches
through the neutral `Connector` model and enum conversion/immutable metadata.
The last focused run passed 59 cases in 65 ms. Shared inherited case reconciliation
uses actual shape and transform test sources; historical receipt status alone was
not treated as sufficient. Remaining graph/formatting gaps stay explicit.

Final focused reconciliation run passed 404 tests across the 59-case owned
connector matrix, three bounded model tests, 273 shared shape regression cases
and 69 shared transform cases. The direct/BDD ledger now has only five remaining
public-model rows: inherited click action/shadow and the three live collection
creation cases. Eleven neighboring/inherited rows remain separate model gaps.
The 41 API rows comprise 12 enum language mappings, 22 bounded model members and
seven explicit unimplemented public model/collection members. This is partial API
coverage, not whole-model parity. Root records maintained checks and screenshots
in `docs/plans/pptx-connectors-integration.md` before committing.

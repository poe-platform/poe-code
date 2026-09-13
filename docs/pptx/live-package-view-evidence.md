# Live presentation and package-view evidence

This receipt extends the existing async Presentation model and its loadShared
state. It does not complete the slide/layout/master/drawing/chart object graphs
or whole public API coverage. See [the exact source/target mapping](live-owner-surface-map.md)
for inherited members, returned private-looking interfaces, genuine private
helpers and remaining obligations. Historical inventories remain provenance,
not automatically promoted implementation counts.

## Public mappings

- `Presentation.element` is the live presentation XML view; `Presentation.part`
  is its cached PartView. Runtime state/limits/input authority use JS private
  fields, and the public part property cannot replace its owner binding.
- PartView exposes `partname`, `content_type`, copied `blob` get/set, immutable
  `rels` and its owning `package`. Relationships expose `id`, `type`, `target`
  and `mode: "internal" | "external"`; targets are metadata and never fetched.
- PackageView `parts` is a frozen membership snapshot of OPC content parts,
  excluding content-types/relationship metadata. `get_part` takes a canonical
  package URI, returns the cached part or null, and rejects host/traversal paths.
  Reads consult current staged state, not the original inventory index.
- PartView additionally exposes `element` for XML content. Binary parts remain
  readable as isolated bytes; their element getter raises PropertyAccessError.
- XML tag/attribute/child/leading-text and mutation mappings are described in
  [the XML view receipt](live-xml-view-evidence.md). Mutating receivers refresh;
  other previously acquired handles invalidate after the document changes.
  Existing canvas/property changes are visible through fresh views, and XML
  changes are visible through existing domain accessors.

## Mutation and publication boundary

Part blob and element mutation share the same XML replacement validation as the
SDK `replaceXmlPart` operation and direct CLI `xml set`. Unqualified attribute and leaf-text edits
retain the existing presentation/slide profile; namespaced attributes are readable
but their mutation remains rejected at this package boundary. Structured edits additionally
allow unchanged existing supported `sp`, `pic`, `cxnSp`, `grpSp` children to move
or be removed within their drawing tree, and existing `r`/`br` children within
a paragraph. Required tree headers and paragraph property ordering remain intact.
Opaque payloads, unknown namespaced attributes, dangling graph references,
protection, dialect changes, arbitrary new structures and cross-parent moves are
rejected by this package-level subset. XML views are not a general XML library.

Binary and other XML part blob mutation remains explicitly unsupported. These
are visible public capability gaps, not private helpers. Metadata remains editable
through the existing property model/operation. View support must not be counted
as inherited model binding for shapes, charts, slides or notes that are not yet
joined to the presentation owner graph.

The shared XML parser and semantic graph validator retain their limits and
partial-validation declaration; no full schema-conformance claim is made. New
XML writes validate explicit slide dimensions before state changes. Read-side
inspection retains the existing ability to inspect repairable partial dimensions.
Successful edits increase the model revision, so edits during asynchronous save
fail before a sink is invoked. Failed mutations leave bytes and handles intact.
Publication uses the existing capability/cancellation/atomic output contracts.
No environment, host filesystem, clock, native process or network access is added.

## Original evidence

`package-view.test.ts` covers view reads, both byte-ownership boundaries, live
canvas/XML edits, null/typed errors, malformed and unsupported writes, invalid
sizes, cancellation, runtime-private authority, stale publication, binary part
preservation and external metadata without network calls. `command-xml-views.test.ts`
uses original small memfs decks to exercise append/insert/remove/replace, run
removal, exact unrelated-part bytes, SDK/CLI equivalence, schema/capabilities,
dry-run and failed publication leaving existing output untouched.
`xml-view-validation.test.ts` independently attacks unsupported structures,
opaque data, references, protection and lowered limits. No publisher documents,
cloned binaries, native runtime, downloaded fixtures or cleanup were used.

The rebuilt command help excerpt was captured through the maintained screenshot
runner at `/tmp/pptx-live-xml-help.png` and visually inspected: complete legible
changed XML help and exit status 0. The full capabilities/schema and public
command result assertions are executable tests, not inferred from that image.

Executed check results and local commit hashes are recorded separately in the
[implementation plan](../plans/pptx-live-package-view.md).

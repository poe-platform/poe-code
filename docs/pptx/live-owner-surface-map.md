# Live presentation owner and package-view review

Date: 2026-09-13. This receipt records a bounded source review before owner-view
integration. It does not certify implemented members or whole public API coverage.
The later [implementation receipt](live-package-view-evidence.md) records the
bounded views and original tests now implemented; other obligations below remain.

Authorities: [format](../specs/pptx.md), [SDK](../specs/office-sdk.md),
[CLI](../specs/office-cli.md), [API audit](upstream-api-audit.md),
[API inventory](upstream-api-inventory.json), [test audit](upstream-test-audit.md),
[test inventory](upstream-test-inventory.json), and
[target register](public-api-map.json). No external retrieval or reference runtime
was needed; the pinned research records were read locally.

## Exact member identities

The source inventory identifies `pptx.presentation.Presentation.element`
(inherited from `pptx.shared.ElementProxy`) and
`pptx.presentation.Presentation.part` (inherited from
`pptx.shared.PartElementProxy`). Their target signatures are read-only
`get element(): XmlElementView` and `get part(): PartView`. Wrapper allocation
alone must not edit XML. `pptx.presentation.Presentation.__eq__` maps separately
to `equals(other)` with owned underlying-element equality; JavaScript reference
identity does not establish this behavior.

The source inventory does not contain standalone `pptx.opc.package.Part`,
`XmlPart`, or package member rows. Returned view closure instead has these exact
additional IDs in the target register. An absent source row is not evidence that
the returned behavior is private or already implemented.

| Exact target-register ID | Declared JavaScript contract |
| --- | --- |
| `target.XmlElementView.tag` | `get tag(): QualifiedName` |
| `target.XmlElementView.attrib` | `get attrib(): ReadonlyArray<XmlAttribute>` |
| `target.XmlElementView.text` | `get text(): string \| null; set text(value: string \| null)` |
| `target.XmlElementView.children` | `get children(): ReadonlyArray<XmlElementView>` |
| `target.XmlElementView.get` | `get(name: QualifiedName): string \| null` |
| `target.XmlElementView.set` | `set(name: QualifiedName, value: string \| null): void` |
| `target.XmlElementView.append` | `append(child: XmlElementView): void` |
| `target.XmlElementView.insert` | `insert(index: number, child: XmlElementView): void` |
| `target.XmlElementView.remove` | `remove(child: XmlElementView): void` |
| `target.XmlElementView.replace` | `replace(old_child: XmlElementView, new_child: XmlElementView): void` |
| `target.PartView.partname` | `get partname(): PartUri` |
| `target.PartView.content_type` | `get content_type(): string` |
| `target.PartView.blob` | `get blob(): Uint8Array; set blob(value: Uint8Array)` |
| `target.PartView.rels` | `get rels(): ReadonlyArray<Relationship>` |
| `target.PartView.package` | `get package(): PackageView` |
| `target.PackageView.parts` | `get parts(): ReadonlyArray<PartView>` |
| `target.PackageView.get_part` | `get_part(partname: PartUri): PartView \| null` |

These are design signatures. Any deliberate implementation difference needs an
explicit receipt and acceptance cases; matching a name is insufficient. In
particular, implementing structured XML input insertion does not by itself prove
the register's owned-view insertion contract. A mutable part-name setter is not
promised by this target view, even though the baseline suite tests source part
renaming. Graph renaming therefore needs a separately accounted safe operation,
not silent reinterpretation of the read-only target property.

## JavaScript and security mappings

Qualified names are records `{ namespace: string, localName: string }`, not
prefix-dependent strings or XPath. Attribute records have a qualified `name` and
string `value`. Missing attribute lookup returns null; nullable attribute writes
remove the selected attribute. Namespace declarations and XML-reserved names
require validation. Child inspection preserves element order and returns a
membership snapshot containing live owned handles. Reading attributes must not
provide a mutable reference that bypasses validation.

`text` is XML node text, distinct from shape/text-frame whole-text replacement
and formatting-preserving `text replace`. Original mixed-content cases must pin
which text segment changes, preserve child and tail content, and distinguish
null from empty text. Owned insert/remove/replace must define same-parent moves,
index boundaries, ancestor cycles, foreign owners, stale handles and replacement
invalidation. No arbitrary constructors, callbacks, dynamic property evaluator,
XPath, dependency descriptors or ambient runtime objects are admitted.

Part URIs are canonical package identities, never host paths. Blob reads and
writes use copied Uint8Array values; writes validate admission, content type and
XML limits. Part and relationship reads must reflect current staged mutations.
Relationship values contain `id`, `type`, `target` and internal/external `mode`;
external targets are inspectable data and grant no network authority. Package
membership returns current live part handles, with absent canonical lookups
returning null. Content-type and relationship parts remain graph-controlled;
view access cannot bypass the package's protection, MCE or publication checks.

In-memory mutations stay synchronous; factory and publication remain always
async. Neutral snake_case properties remain primary. Typed invalid value/type,
read-only-property and invalid-handle failures follow format section 6.8. Resource
limits and cancellation apply to every serialization and publication path.
Publication must reject dangling targets, invalid content types and stale state
before invoking a destination, preserving preexisting destination bytes.

The shared CLI routes reads through noncreating inspection and writes through
validated SDK operations. The target register's `xml.*` batch operations are
proposed, not proof of executable routes. Actual routes require common schemas,
version-1 results and exit statuses; no generic model method evaluator is allowed.

## Genuine private mechanics versus returned public behavior

`_PackageLoader` and descriptor/cache construction are implementation mechanics;
their baseline helper-call assertions can map to observable bounded admission
and publication tests. `PartFactory` dispatch and `_ContentTypeMap` representation
need not become public constructors: content type resolution and custom/unknown
part preservation remain observable obligations.

`_Relationships` and `_Relationship` cannot be excluded just because of their
names when reached through public `rels`. The bounded target currently promises
relationship inspection, while source collection mutation/lookup and graph
renaming cases remain separate obligations requiring an explicit safe mapping.
Likewise documented `_GradientStop`, `_OleFormat`, `_MediaFormat`, `_Cell`, `_Run`
and inherited element/part access remain public. Their presence does not require
copying an entire dependency API, and this presentation receipt does not resolve
their owner integration.

## Source evidence and integration constraints

At this checkpoint `presentation-model.ts` already uses `loadShared` for the
factory, CoreProperties and canvas edits, and `state.finish` for save. Extend that
owner instead of adding another editor. `Shape`, `Connector`, `Table`, text-frame,
paragraph, run, fill and link implementations already contain real behavior.
Their nested mutations need the same owner state before claiming live graph
coverage; detached instances cannot stand in for integration.

`loadShared.doc(part)` reparses current staged bytes on each call. Raw node
identity therefore does not survive repeated reads by itself. A view must either
retain an owner-managed document or resolve an explicit validated identity/path;
returning detached parsed nodes loses later mutations. The original selection
index describes admitted input and cannot alone answer relationship reads after
staged graph writes. Save's revision check must include view writes as well as
metadata/canvas writes. Staged XML must retain unknown content through the existing
parser and serializer, and `finish` must continue validating the final graph.

Relevant exact baseline IDs include
`tests/test_presentation.py::DescribePresentation::it_knows_its_part`,
`tests/test_shared.py::DescribeElementProxy::it_knows_its_element`,
`tests/test_shared.py::DescribeElementProxy::it_knows_when_its_equal_to_another_proxy_object`,
`tests/opc/test_package.py::DescribePart::it_can_change_its_blob`,
`tests/opc/test_package.py::DescribePart::it_knows_the_package_it_belongs_to`,
`tests/opc/test_package.py::DescribePart::it_provides_access_to_its_relationships_for_traversal`,
and `tests/opc/test_package.py::DescribeOpcPackage::it_can_iterate_over_its_parts`.
They are research provenance, not copied fixture or test-name prescriptions.
Original tests must additionally cover every target view behavior without an
upstream case, byte ownership, limits, foreign/stale handles and no-publication
failures. This review did not execute tests or mark these baseline cases adapted.

## Documentation drift boundary

The test-audit header's “TypeScript adaptation not started” is a historical
baseline. Existing implementation receipts and tests supersede that statement
only for their bounded behaviors. Similarly, the earlier public-surface gap
receipt predates the existing Presentation factory: factory absence is no longer
a current finding, but missing slides/layouts/masters and drawing owners remain
outstanding. Neither historical `not_implemented` rows nor an export count are a
current coverage certificate. Existing documented corrections for return types,
background setter, enum spelling and invalid freeform/cell prose remain intact.

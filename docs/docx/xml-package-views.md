# Bounded XML and package object views

Scope: `sdk-xml-package-views`. These views extend the existing live style and
formatting owners and the admitted document package. They do not introduce a
second document editor. The [exact scoped register](xml-package-view-api-map.json)
overlays the historical inventories; it does not promote their whole-format
coverage counts. Earlier utilities whose full live Document, Paragraph, Table,
Drawing, Settings and story owners remain absent retain explicit public API
obligations. Public underscore-prefixed returned types are included.

## XML language and security mapping

Every existing style, latent-style, font, color, paragraph-formatting and tab owner
returns a bounded `XmlElementView` from `.element`; `.part` remains its original
owner. XML part views also expose the same bounded surface. This is the explicit
replacement for an unrestricted native XML dependency interface.

| Public behavior | JS contract and boundary |
| --- | --- |
| `tag` | Frozen `{namespaceURI, localName}` expanded name. `localName` and `namespace` are compatibility read conveniences. Prefix spelling is not identity. |
| `attributes` | Fresh `ReadonlyMap<ExpandedName, string>` snapshot; names are frozen values. Namespace declarations are excluded. Map keys have ordinary JS object identity; compare expanded-name fields when looking up a snapshot. Mutating a snapshot cannot edit the owner. |
| `children` | Frozen ordered array of live element-only views. Positions are zero-based. Text, comments and processing instructions are not child handles. |
| `text`, `tail` | Synchronous nullable leading/following text, including CDATA as text. Assignment affects the consecutive leading/following text tokens, preserving other mixed content. Root tails permit XML epilog whitespace; invalid epilog text rejects. Empty text reads as null. |
| `set_attribute(name, value)` | Validated expanded name and string, or null to remove. XML NCNames use the existing Unicode scalar grammar, not interpolated XML syntax. Namespace declarations and affected unsupported attributes reject. |
| `insert(index, node)` | Closed recursive element/text/comment/processing-instruction data. Element insertion returns the new owned element view; other tokens return the containing view. No strings containing markup, XPath, evaluation or operation-supplied callbacks. Comment/PI/name/value grammar and depth/work/output budgets validate before acceptance. |
| `remove()` | Removes the owned element. Retained descendants invalidate. Required document roots/body and invalid graph edits reject. Style/latent removals update the original keyed collections and invalidate their model handles. |
| `serialize()` | Fresh UTF-8 bytes for the element and its descendants with necessary namespace context. Outer tail and document declaration/epilog are excluded; original prefix/empty-element lexical spelling is not promised. Original package encoding/untouched bytes remain under the existing publication engine. |

Sibling handles follow structured insertion/removal in their binding. External
changes through overlapping domain owners conservatively invalidate descendant
views; root views keep owner identity. Deleted/recreated style names never revive
old handles. Owner reads, writes, traversal and serialization share cumulative
budgets and cancellation, including standalone formatting owners without an
explicit budget. Opaque affected branches/attributes reject under the maintained
compatibility profile; inactive/unselected content is preserved. The JSON schema
expresses a closed expanded-name record; its identifier declaration is broader
than XML NCName grammar. Runtime SDK and CLI validation apply the exact scalar
NCName grammar in addition to schema validation. JSON Schema alone is not a
complete XML/security admission certificate.

## Package and returned-resource mapping

`model.package.Package` and `model.opc.package.OpcPackage` share `PackageView`.
`Part`, `XmlPart`, `StylesPart`, `CorePropertiesPart` and `ImagePart` use the live
`PartView`, `XmlPartView`, `StylePartView`, `CorePropertiesPartView` and
`ImagePartView` types. Base members are inherited, including neutral snake_case
methods. Constructors are trusted owner-binding hooks, not arbitrary detached
XML/graph input transports. Loading uses the async admitted factories.

| Surface | Behavior |
| --- | --- |
| `parts`, `iter_parts`, `iter_rels` | Owned live views with deterministic reachable graph traversal and bounded cycles. Image collections enumerate declared image parts, including orphans. |
| `rels`, `related_parts` | Owner-local relationship-ID keys. Related-part maps are snapshots excluding external edges. |
| Relationship returned type | The documented `_Relationship` is public and maps to `RelationshipView`: `rId`, `reltype`, `is_external`, `target_ref`, `target_part`. External target strings remain inert; accessing their owned `target_part` fails. No linked fetch or activation. |
| Relationship protocols/helpers | JS `length`, iteration of keys, `has`, `at`, `get`, `set`, `delete`, `keys`, `values`, `items`, `copy`, `clear`, `update`, `setdefault`, `pop`, `popitem`; neutral `add_relationship`, `get_or_add`, `get_or_add_ext_rel`, `part_with_reltype`. Defaults and missing-key errors are distinct. Tuple arrays/maps replace dependency dict/tuple records. |
| Relationship mutation | Same-package target ownership, matching entry ID, scoped ID uniqueness, rebased relative targets, graph validation, lexical comment retention. Foreign/detached entries reject. Removal invalidates retained relationship views; a popped return is detached and cannot dereference a removed edge. |
| Part metadata | `blob` copies, inert `content_type`, immutable `PackURI` values from `partname`, original `package`, inherited relationships and lifecycle hooks. |
| `partname` assignment | Transactionally updates content-type overrides, relationship-member names and all incoming/outgoing internal relative references, including fragments. Default-based content types survive extension changes. Existing owner/image identities follow the rename. Occupied names reject. |
| `load` | Async owned byte admission into an existing package with exact content-type registration. XML factories reject DTDs/invalid XML. Image loading characterizes and checks the signature before staging. Entry/package/member/path/work/retention limits and cancellation stay in force. Generic `PartView.load` can return a declared subtype. |
| XML part `element`, `part` | Cached live XML view and self owner. Structured writes validate the candidate graph before staging; growth past the admitted entry ceiling rejects without changing bytes. |
| Live styles part | `.styles` reuses the existing Styles domain. `default(owner)` returns this owner's live root styles part; it does not load an external default template or manufacture detached collections. |
| Lifecycle hooks | `before_marshal` / `after_unmarshal` validate ownership and the maintained core-v1 graph. Package finalization also refreshes graph admission. No dynamic subclass callback dispatch or native parser lifecycle API is exposed. |
| Core properties | All fifteen neutral scalar/date/revision properties, `.element` and `.part`. Strings are at most 255 Unicode scalars; revisions are positive safe integers on assignment and default to zero on absent/unreadable stored values. Nullable reads for absent dates; assignments require valid owned UTC Dates, truncated to whole seconds. Date getters return copies. Values use the existing property declarations and part-creation engine. |
| Core-properties `default` | Returns/creates the original owned core resource. Repeated access keeps resource identity. The template/metadata determinism policy remains the existing model policy. |
| Image resources | `image_parts`, `get_or_add_image_part`, collection length/iteration/has/append/admission, `image`, `filename`, `sha1`, `default_cx`, `default_cy`, inherited Part members. Async byte-equality deduplication; raster values reuse the existing immutable Image domain and independent axis DPI defaults. |
| Image factories | `load` and `from_image(image, partname, owner)` are always async. The explicit owner argument replaces detached source construction; the image is readmitted under the receiving owner's limits. SHA-1 remains compatibility metadata. |
| Image compatibility | Characterization supports PNG/JPEG/GIF/BMP/TIFF headers, not decoding/rendering. Uncharacterizable or vector payloads remain available as owned parts; characterization getters reject. Existing malformed inert payloads do not block unrelated edits. Collection `append` verifies an already admitted same-package image; new images enter through admission, not detached/foreign append. |
| Package factory/output | `PackageView.open(input, context)` uses the existing async model admission, including original default creation policy. `save(sink)` uses its guarded publication engine and validates an explicit byte sink. Capability-scoped VFS publication is available through the model's existing `publish(options, context)`; an ambient string/path is not a writable capability. |

`main_document_part` returns a bounded `XmlPartView`, not a fabricated complete
DocumentPart model. The historical DocumentPart-specific story/document APIs
remain public and planned. Likewise inherited `StylePartView.load` is the base
XML admission factory, returning a generic owned XML view rather than a second
Styles domain. A detached styles factory is not advertised as typed-batch
execution. These limits prevent whole model-API coverage claims.

## Shared command/publication contract

All enabled IDs use the existing SDK-backed `batch INPUT --ops-json/--ops-file`
route, named checked handles, camelCase JSON arguments, common limits and flags,
version-1 results and established exit statuses. Nonroot guessed handles,
unknown fields, invalid names, forward handles and foreign receivers reject.
Awaited factory handles resolve to their value type; subtype receivers use
checked inherited compatibility. Bytes serialize as explicit base64 records,
Dates as UTC strings, maps as key/value entries and tuples as arrays.

No model operation performs implicit network or host I/O. Batch-level flags
control one staged publication. `Package.open` and `Package.save` have SDK
capabilities but are deliberately not executed as nested batch operations:
opening another document would introduce foreign state, and nested save could
write before later batch validation. Use the batch input and top-level output
flags as their equivalent safe command capabilities. Explicit owner-part loads
stage into the same batch graph; schemas now correctly declare their mutation.
Deduplication and idempotent collection append do not count as changes.

Graph edits validate before acceptance. Style-definition validity and the whole
candidate core-v1 graph validate before the sink receives bytes. Protection,
signed/macro input, publication capabilities and original encoding constraints
use the maintained engine. Asynchronous serialization captures both domain and
graph revisions; overtaking edits reject with conflict and write nothing. A
committing sink cannot mutate the live owner. No full OOXML schema, layout,
cryptographic signature, schema-extension or native runtime parity is claimed.

## Evidence

Original small memfs tests cover XML reads/writes, ownership/invalidation,
Unicode/name injection, mixed content, opaque rejection, budgets/cancellation,
structured collection changes, resource admission/deduplication, inert media,
content-type renaming, cyclic traversal, relationship helpers/protocols,
properties, SDK/CLI result schemas and publication races. No publisher file,
reference fixture/runtime or network query was used. The retained research
API/test inventories remain historical; the scoped register distinguishes
executed original assertions from source-case pointers and APIs without tests.

Maintained-check receipts and visual QA are recorded in the
[owned plan](../plans/docx-xml-package-views.md). Screenshot review uses actual
built public-engine help and errors displayed through the maintained terminal
runner; it does not claim root docx registration or document rendering.

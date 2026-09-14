# Ordered DOCX OPC package graph

Task: `opc-package-graph`, 2026-09-14. Only the bounded package-graph task is
implemented here. Later XML, live-model, command, editing and publication tasks
remain pending. The already edited pipeline and unrelated plan move are preserved;
this standalone execution receipt is the owned plan update.

## Scope and implementation

`readDocumentArchive` keeps its name and existing result fields. Its new `package`
field exposes a synchronous snapshot of the admitted graph. Product logic stays
in `packages/docx`; root and safe-bash are unchanged. The existing scanner and
neutral error classes move to `package-xml.ts` for shared admission use.

- `parts` preserves archive member order, includes relationship parts and opaque
  unreferenced parts, and excludes directories and the content-types stream.
  Each part retains its original member name, bytes and date, and exposes
  `partname` and `content_type`. Unrelated edits retain every other payload,
  including content-type declarations, comments and processing instructions.
- `defaults` and `overrides` preserve declaration order within each collection,
  original extension/media-type spelling, and override precedence. Original
  stream bytes retain interleaving between the collections. Unknown types,
  parameterized types and unfamiliar valid extension defaults are retained.
- `relationships(owner)` takes `/` for the package or an absolute part URI. IDs
  are unique per owner, never globally. Internal edges refer to the same part
  object when they share a resource. External targets remain exact inert strings;
  requesting their `target_part` raises `InvalidValueError` with code `usage`.
- `iterParts()` performs iterative depth-first traversal from root edges in XML
  order, visits each reachable part once, and skips external targets. `parts`
  separately inventories unreachable content so traversal never implies deletion.
- `allocateRelationshipId(owner)` reserves the first available `rIdN` separately
  for each owner. `allocatePartName(prefix, suffix)` reserves the first available
  numbered name across the entire package, including unreferenced parts. Repeated
  reservations cannot return the same identifier. Member, encoded path length and
  depth ceilings also constrain new part reservations. Reservations do not change
  payloads or publish a package; future staged editing must consume them and
  validate its final graph. Numbering/drawing/note/comment IDs belong to their
  later feature tasks and do not reuse the relationship allocator.

Metadata records and arrays are frozen. Payload bytes remain the owned archive
buffers already provided by admission; this is a graph snapshot, not the future
live XML model. A changed archive must be re-admitted to obtain a current graph.
The constructor is not exported as a package entry-point value; loading remains
through the bounded async admission boundary. The original raw archive writer
remains a raw codec and does not become a validated document publication API.

## URI and validation decisions

Reviewed the pinned ECMA-376 Part 2 fifth edition (December 2021), clauses 6.2.2,
6.4.3, 6.5.2–6.5.3 and 7.2.3–7.3.5, plus the actual content-types and relationships
schemas under the existing research directory in `standards-sources.json`.
[Microsoft's owner-relative resolution guidance](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/opc/resolving-a-part-name-from-a-relationship-s-target-uri)
was crosschecked; no reference runtime or new fixture download was used.

`normalizePartName(name: string): string` requires an absolute part URI. It
normalizes percent hex case, decodes UTF-8 non-ASCII characters to the logical IRI,
preserves escapes for reserved ASCII characters, and rejects escaped ASCII
unreserved characters in declared names. Invalid escapes, encoded separators,
controls, empty segments and trailing dots reject. Name comparison folds ASCII
case only; non-ASCII upper/lowercase names remain distinct. Duplicate equivalents,
ancestor/descendant part names and NFC-equivalent aliases explicitly reject.
NFC collision rejection implements the standard's normalization recommendation
as a stricter admission policy; it does not rewrite stored names.

`resolvePartTarget(owner, target)` returns `{ partname, fragment }`. Internal
rooted and relative references use the owner directory, normalize unreserved
escapes, remove literal dot segments and clamp excess `..` at package root under
URI resolution rules. Fragments remain separate inert strings, including escaped
separators and query characters inside the fragment. Queries in the part target,
authority/scheme targets in internal mode, encoded separators, and encoded
navigation segments reject. `relativePartTarget(owner, target)` emits an encoded
relative reference, including UTF-8 percent encoding and an explicit `./` before
a first segment containing a colon. No host path resolver or resource acquisition
is involved. Fragment semantics beyond identification remain a later feature.

The graph validates required type/root/main parts, content-type coverage and
duplicates, every owner relationship file, orphan owners, duplicate IDs, XML ID
syntax, target modes and dangling internal targets. Relationship parts cannot
source or receive relationships. The main document must be the sole internal
root office-document relationship, without a fragment. It is never found by a
fixed member name. Namespace/structure/attribute validation rejects prohibited
`xml:base` and stray metadata text. DTD/malformed XML errors retain their separate
category. Full MCE/XML schema interpretation remains in the subsequent tasks;
unsupported metadata extensions currently reject rather than being interpreted.

## Exact JS and API mapping boundary

Reviewed `docx.md`, `office-cli.md`, `office-sdk.md`, the API audit, all inventory
records selected by OPC/package ownership, the reconciliation report, public API
map and the 87 test crosswalk rows assigned to this task. This does not replace the
920-record inventory or claim the 1,337 proposed API rows are implemented.

The new boundary uses owned `Uint8Array`, explicit `ArchiveContext` limits and
`AbortSignal`, always-async `readDocumentArchive`, synchronous metadata queries,
readonly arrays with `.length`/zero-based lookup/JS iteration, and a JS generator
for graph traversal. Read-only part metadata retains neutral `partname`,
`content_type`, `rId`, `reltype`, `target_ref`, `is_external` and `target_part`.
Unknown-owner/missing-part queries and external `target_part` access throw the
existing `InvalidValueError`; typed input failures use `InputTypeError`, both
with `usage`. Invalid package and XML data retain `invalid-package` and
`invalid-xml`; resource/cancellation categories stay unchanged. There is no
ambient path, network, time, author, font, eval or dynamic-dispatch capability.

These are graph infrastructure functions, not a second spelling layer for the
future `PackURI`, `Part`, `Relationships` or `Document` model. Public underscore
names, inherited members and dictionary protocols stay in the public API map;
none is made private or counted as implemented by this snapshot. In particular,
the authoritative specification's `get`/`items` plus throwing keyed `at` mapping
supersedes the older inventory's `get`/`getOrNull`/`entries` suggestions. No aliases
from that older research spelling are introduced here. Existing `comment_id` and
`timestamp` documentation corrections remain intact.

The later CLI/model loading routes must use the same admission graph. No CLI
registration, command grammar, selector, JSON envelope, schema/capabilities claim,
or SDK-only document edit is added. Proposed plural resource routes and `text
replace` remain pending under the shared contracts. Thus no CLI screenshot is
applicable to this package-only infrastructure change.

## Crosswalk ownership reconciliation

The historical `test-case-map.json` is retained. Its 87 rows assigned to this task
mix graph obligations with later public-view, XML serialization, core-property
and image-admission work. The following exact ranges use their existing order
within `rows.filter(row => row.owning_task.id === "opc-package-graph")`, one-based.
They are dispositions, not 87 executed source-test passes. All product tests use
original wording and small authored bytes; no external implementation, mocks or
binary assets are copied.

| Crosswalk rows   | Bounded mapping and remaining owner                                                                                                                                                                                                                                                                                                           |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1, 3, 5, 10–12   | Defaults/overrides/edge attribute values and ordered collections: covered by the nonstandard-main graph case, inert-external cases and the unfamiliar-default case. XML element wrappers/construction remain `sdk-xml-package-views`.                                                                                                         |
| 2, 4, 6–9, 13–14 | XML builder/serializer mechanics: original fixture construction supplies metadata and verifies parsed values here; mutable XML constructors and serializer API acceptance remain `loss-preserving-xml-write`/`sdk-xml-package-views`, not implemented by fixture setup.                                                                       |
| 15–20, 26, 29–31 | Observable loading, root/owner edges, ordered inventory, reachability, related-part identity and cycles: nonstandard-main/shared-resource tests. Loader factories and mock callback identity are mapped to observable admitted graph state, without executing arbitrary loaders. Public add/relate operations remain `sdk-xml-package-views`. |
| 21–25, 84–86     | Exact number boundaries `[]→1`, `[1]→2`, `[1,2]→3`, `[2,3]→1`, `[1,3]→2`: original parameterized package-name allocation tests, plus case-collision and repeated-reservation assertions. Image-specific wrappers stay pending.                                                                                                                |
| 27               | Owned sink round trip and unrelated byte preservation: memfs repacking case and original archive-writer tests. Public model save remains the async-capability/publication task.                                                                                                                                                               |
| 28               | Lazy default core-property creation is a later document-properties/model task; package admission intentionally does not create metadata during inspection.                                                                                                                                                                                    |
| 32–40            | Relative URI construction, required leading slash, canonical absolute name, relative encoded output and owner relationship resolution: URI tests. Public `PackURI` properties `baseURI`, `ext`, `filename`, `idx`, `membername`, `rels_uri` remain `sdk-xml-package-views`; helper behavior is not counted as those public members.           |
| 41–49, 57–62     | Part content type/name/bytes and opaque typed fallback: graph inventory/preservation tests. Public live ownership, rename, XML views, factory dispatch and loader hooks stay with `sdk-live-object-model`/`sdk-xml-package-views`/XML serialization. No hidden private-type exclusion.                                                        |
| 50–56, 66–78     | Owner IDs, shared target identity, target reference, external target failure, cycles and ordered edge values: graph/inert-target tests. Public mutable dictionary, add/get-or-add/drop and relationship XML serialization remain the later package-view task; no automatic shared-resource deletion is introduced.                            |
| 63–65            | XML reference-count-sensitive removal requires the subsequent namespace/XML and removal work. Input XML child-reference counting is not inferred merely from package edges. All resources remain preserved here.                                                                                                                              |
| 79               | First available relationship number, gaps, repeated reservation and separate root/main/side owner scopes: ID allocation test.                                                                                                                                                                                                                 |
| 80–83, 87        | Image acquisition, format admission and content-hash deduplication belong to later image tasks. This task covers shared graph identity and retention, not image hashing or insertion.                                                                                                                                                         |

This resolves overbroad ownership and older mapping spelling without silently
marking future API operations complete. The full model/API gate must still close
all these later obligations under their original recorded evidence.

## Failing tests before code

Original `package.test.ts` was added before implementation. All mutations use
memfs; no test writes host files or depends on downloads. Existing tests retain
their names and cases.

1. `/tmp/docx-opc-red.log`: maintained workspace unit command produced 34 failures
   and 109 passes. Concrete admission failures included acceptance of owner-level
   duplicate IDs, dangling targets, invalid modes/IDs, xml:base, orphan owners,
   relationship-part targets and derived names. Missing graph/URI APIs and wrong
   Unicode/reserved-character handling supplied the remaining red evidence.
2. `/tmp/docx-opc-red-followup.log`: three failures/149 passes before fixing valid
   fragment rejection and non-whitespace text acceptance in two metadata parts.
3. `/tmp/docx-opc-red-types.log`: two failures/152 passes before allowing schema-
   valid unfamiliar extension defaults and case-insensitive known media types.
4. `/tmp/docx-opc-red-reservations.log`: two failures/154 passes before enforcing
   allocation ceilings and rejecting coercion of prefix/suffix arguments.

Invalid URI tests assert the typed `invalid-package` code, so an absent function
cannot satisfy their final negative assertions. Required-part regressions and
original admission tests remain alongside the new failing cases.

## Verification and local delivery

- `npm test --workspace=docx`: 156 tests pass, including 62 new OPC tests; log
  `/tmp/docx-opc-final-tests.log`.
- `npm run lint --workspace=docx`: passed ESLint and both source/test TypeScript checks.
- `npm run build:workspaces -- --workspace=docx`: passed the declared DOCX and
  shared codec dependency build closure.
- Built `docx` package export smoke check: passed a memfs ZIP write/admission
  round trip, root target identity, allocation and all three URI helper exports.
- Owned Prettier and `git diff --check`: passed. No shared infrastructure or
  visual CLI changed, so repository-wide/CLI screenshot gates were not needed.

No shared codec, root, adapter, dependency manifest, README or downloaded fixture
changes are owned. One atomic Conventional Commit will contain the graph, URI
handling, admission integration, original regressions and this receipt. Stage
only those explicit paths, with normal hooks. No push or release.

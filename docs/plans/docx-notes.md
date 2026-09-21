# Bounded footnote/endnote task

Scope: the original TypeScript utility's notes.list/get/add/set/remove paths,
references, separator/continuation entries, storage IDs and preserved numbering.
Later tasks, note batch execution and new live note model owners remain pending.

## Current implementation and acceptance

The existing domain editor in packages/docx owns the five utility paths. The
command engine invokes the same editor; safe-bash remains an I/O adapter and root
only wires exports. Preserve original names and tests. Read operations do not
create parts. Add allocates an unused positive ID in the owning note kind, an
internal part relationship and content-type entry when needed. Imported normal
ID zero remains admitted. Duplicate/missing/unresolved IDs fail before publication.

Special entries are identified by type rather than conventional ID: separator,
continuationSeparator and continuationNotice retain their IDs and content.
Mutations repair missing separator/continuationSeparator entries using -1/0 when
free and unused positive IDs otherwise. Existing continuation notices survive.
Preserve is the default storage-ID policy; explicit document-order remaps all
affected editable references and normal bodies while excluding special IDs.
Document and effective section format/start/restart rules are read and preserved;
storage-ID compaction does not compute rendered numbers or page restarts.

Shared references require explicit cardinality for removal and shared true for
whole-body assignment. Removing one reference retains any otherwise referenced
body, including raw inactive-branch ownership. Independent bookmark/comment/
permission ownership also retains the body. Simple note text assignment preserves
markers and first-paragraph properties, rejects rich/opaque or review content,
and removes surplus plain paragraphs. Rich paragraph/table/image bodies reuse
the existing scoped story editors. Resource relationships and bytes survive.

This task reproduced one remaining destructive behavior: removing the last
reference deleted independently tracked insertion/deletion history inside a
footnote or endnote body. Original memfs-backed regressions failed by finding the
entire body missing in serialized XML before the product edit. The budgeted raw
ownership walk now uses the shared revision classifier to retain review-bearing
bodies, including opaque classified revisions. Reference removal still proceeds;
the retained body has no references and an addressable nonnull after location.
The regression fixtures use original wording and explicit UTC timestamps.

An initial standalone bookmark-end probe failed input validation (no preceding
start), not reference removal. It was discarded rather than treating invalid
input as a validated deletion defect. No range-end acceptance change is claimed.

Existing tests cover Strict/Transitional creation, independent note kinds,
multi-paragraph/table/image bodies, shared references, inactive branches, integer
lexical forms, duplicate/missing IDs, special-ID collisions, separator repair,
reference-order compaction and numbering inheritance. New direct command tests
cover all five paths for both kinds, JSON reads against SDK snapshots, dry-run,
pure binary publication and review-history retention. All mutations use memfs.

## Exact JavaScript and security mappings

| Surface | Exact mapping and behavior |
| --- | --- |
| notes.list/get | inspectDocumentNotes(input: Uint8Array, request: NoteReadRequest, context: ArchiveContext): Promise<NoteReadData>; readonly snapshots, never a creating live getter. List defaults both kinds; get defaults footnote. |
| notes.add/set/remove | editDocumentNotes(input: Uint8Array, request: NoteEditRequest, context: PublicationContext): Promise<NoteEditData>; explicit publication capabilities, staged validation, dryRun and nullable output receipt. No ambient host I/O. |
| IDs and references | Safe integer storage IDs scoped by footnote/endnote owning part; returned reference Locations carry package fingerprints. CLI note/reference ordinals are one-based; tokens reject stale state. Snapshot references do not confer live mutation authority. |
| Text and rich bodies | Strings are decoded logical text. Whole-note assignment is destructive only for supported plain paragraphs; paragraph/table/run/text operations edit explicitly scoped rich stories through shared primitives. No second editor or model alias layer. |
| Numbering | {format: string, start: number, restart: string} document/effective-section snapshots. Inherited defaults remain decimal/1/continuous. Stored eachSect/eachPage rules survive; no renderer, pagination or calculated displayed numbering. |
| Options and errors | CamelCase options mechanically match kebab-case flags, including dryRun, allowEmpty, renumber, reference and references. Shared version-1 envelopes; reads have affected 0. Usage exits 2, invalid package/unsupported/selection exits 1, publication exits 3, limits exit 4 and cancellation exits 130. SDK retains neutral typed errors and stable codes. |
| Acquisition and publication | Always async admitted bytes or capability-scoped VFS, explicit sinks, cancellation and shared lowered budgets. No native reference build, product networking, downloaded assets or ambient author/time/font discovery. |

The shared office CLI/SDK contracts remain authoritative. Neutral live-model
snake_case names are unchanged; utility options are a separate declared surface.
The pinned schema-v2 API inventory and audit contain no note-specific public
model owner. Related WD_BUILTIN_STYLE values FOOTNOTE_REFERENCE (-39),
FOOTNOTE_TEXT (-30), ENDNOTE_REFERENCE (-43) and ENDNOTE_TEXT (-44) retain their
historical language-mapped/unmapped_not_implemented inventory dispositions;
utility tests do not promote those rows. Document, Part/XmlPart, inherited
members, collections, helpers/enums, APIs lacking upstream tests and publicly
documented underscore-prefixed owners retain their existing explicit obligations.
No unsupported API is hidden based on spelling; no whole-public-API claim follows.

The existing spec/audit link now resolves to this task record, correcting that
documentation drift without rewriting historical evidence or inventory counts.
No reference implementation material or third-party assets were introduced.

## Maintained verification

- Focused notes/domain/discovery: 29 tests passed.
- Direct notes CLI/SDK parity: 4 tests passed.
- `npm test --workspace=docx`: 246 files / 5,141 tests passed.
- `npm run lint --workspace=docx`: ESLint and both TypeScript checks passed;
  one existing unused-variable warning in operation-types.test.ts, no errors.
- `npm run build:workspaces -- --workspace=docx`: selected maintained dependency
  closure passed (five builds, shared cache, zero cache hits).

No human CLI presentation, help or design language changed; direct command tests
verify JSON locations and binary publication. No screenshot tests were added.

Commit only owned source/tests and this plan on main after maintained checks pass.
Do not push or release. Preserve unrelated changes and historical evidence.

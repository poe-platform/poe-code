# Bounded classic-comment utility task

Scope: original TypeScript comments.list/get/add/set/remove, explicit identity
and time, classic range/reference ownership, package declarations and annotation
preservation. Later tasks remain pending. No push or release is authorized.

## Existing behavior and bounded correction

The five operations already live in packages/docx. CLI and SDK invoke the same
domain implementation; safe-bash supplies capabilities and root only wires exports.
Read operations are noncreating. Creation requires a nonempty body paragraph
range with endpoints at existing run boundaries, including table-cell paragraphs.
Strict and Transitional namespaces are supported. Cross-story, partial-run,
controlled/revision/hyperlink/field and overlapping-comment ranges reject. All
runs between the endpoints belong to the range; overlapping bookmarks retain
their exact original XML. Creation allocates an unused nonnegative ID, matching
range start/end/reference markers, and an owning comments relationship, part and
content-type override if absent. No implicit author, clock or host authority.

Bodies remain separate from default visible text. Reads expose stored metadata,
body text and addressable anchors. Missing, duplicate, unsafe and mismatched
ownership is validated; deleted-anchor bodies remain readable and removable.
Targeted removal deletes only the selected body and its markers, preserving
reference-run neighbors and unrelated annotations. Existing rich bodies remain
readable; whole-text assignment rejects affected unsupported rich blocks.

The new original regression reproduced silent deletion of a footnoteRef in a
surplus comment-body paragraph during comments.set. The pre-change SDK call
resolved successfully and published bytes instead of rejecting. Whole-body
replacement now budget-walks each paragraph to be discarded and refuses shared
paragraph reference markers before publication. The retained first paragraph
continues preserving its marker XML and formatting exactly. Original memfs
regressions cover footnoteRef/endnoteRef refusal through SDK and CLI, exit 1,
zero output bytes, and exact retention of an unrelated comment and main story.
Plain multi-paragraph replacement remains supported by the original tests.

An empty intervening field/controlled-content probe was already refused by
DocumentLocations.range with missing-selection. That suspicion did not validate
a comment-editor defect; no product change or retained failing probe follows.
No downloaded fixture, reference build or derived implementation was used.

## Exact JavaScript and security mappings

| Surface | Mapping, defaults and ownership |
| --- | --- |
| Utility reads | inspectDocumentComments(input: Uint8Array, request: CommentReadRequest, context: ArchiveContext): Promise<CommentReadData>; readonly snapshot types, no creating getter. comments.list returns sorted IDs; comments.get selects one body. |
| Utility mutations | editDocumentComments(input: Uint8Array, request: CommentEditRequest, context: PublicationContext): Promise<CommentEditData>; shared editor, staged serialization/reopening, explicit sinks/VFS, dryRun and nullable publication receipt. |
| Creation metadata | Required author: string and timestamp: explicit UTC string. text defaults to empty string and rejects null. initials defaults to empty string; explicit null omits the attribute. No identity/time discovery. |
| Comment metadata | comment_id: nonnegative safe integer; author: string; initials: string or null; timestamp: stored string or null; text: decoded logical string. This utility timestamp is not the live model's UTC Date-valued property. |
| Anchors and selectors | Fingerprinted Location tokens with scalar text offsets; range snapshots contain start/end/reference part and zero-based XML path arrays. CLI comment ordinals are one-based, sorted by storage ID; model Comments.get uses storage ID. Stale/ambiguous/missing selection fails rather than falling back. |
| Body assignment | comments.set requires text: string; preserves metadata, main-story anchors, first-paragraph annotations and unrelated bodies. Refuses rich/annotated discarded paragraphs. Whole assignment differs from formatting-preserving text replace. |
| Errors and output | Version-1 common command envelopes and camelCase SDK options mechanically map to kebab-case flags. Usage exits 2; invalid/unsupported/selection exits 1; I/O exits 3; limits exit 4; cancellation exits 130. SDK preserves neutral typed errors/codes. Refusal publishes nothing. |
| Authority | Always-async admitted bytes/acquisition/publication, owned byte copies, explicit capability-scoped filesystem/streams, cancellation and cumulative lowered budgets. No native build, product networking or ambient host I/O. |

The shared office-cli and office-sdk contracts remain authoritative. Utility
operation option names do not rename the neutral snake_case object model.

The pinned upstream-api-inventory.json is historical research, not current
execution evidence. Comment/Comments constructors and Comments.add_comment/get,
Document.add_comment/comments and Run.mark_comment_range retain their recorded
model obligations; this utility fix does not promote them. Existing later live
model evidence in docs/docx/live-model-integration.md remains authoritative for
its own qualified subset. Inherited Comment.add_paragraph/add_table,
iter_inner_content/paragraphs/tables, part/element, Comments iteration/length,
CommentsPart and inherited package/XML/resource APIs, enum values, helpers and
APIs without reference tests remain separately accountable. Public underscore
types are not hidden or excluded. This task makes no whole-public-API claim.

Documentation-error dispositions D01/D02 remain exact: use comment_id/timestamp
rather than id/date; paragraphs belongs to Comment, not Comments; add_run belongs
to Paragraph, not Comment. No aliases are introduced. The missing spec/audit
link target now resolves to this task record, correcting that documentation drift
without rewriting the historical inventory, evidence or later model overlays.
Modern extension synchronization retains its separately verified existing subset;
thread authoring and cross-paragraph utility anchor creation remain pending.

## Maintained verification and delivery

Failing regression preceded product code. Existing names and tests are retained.
The positive exact-run assertion initially omitted the existing editor's explicit
namespace context; the original fixture now includes that context and all 22
comment tests pass. No product namespace behavior was changed for the assertion.
Completed checks:

- Focused comment suite: 22 tests passed.
- npm run lint --workspace=docx: ESLint and both TypeScript checks passed;
  one existing unused-variable warning in operation-types.test.ts, no errors.
- npm run build:workspaces -- --workspace=docx: maintained five-build dependency
  closure passed with the shared cache; zero cache hits.
- npm run test --workspace=docx: fresh maintained rerun passed all 246 files /
  5,144 tests after correcting the positive fixture's namespace context.

There is no change to human presentation, help or design language; no screenshot
tests are added. Only owned source/tests and this task record may be staged.

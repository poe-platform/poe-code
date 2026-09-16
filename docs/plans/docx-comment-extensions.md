# DOCX comment extension synchronization

Scope: only the bounded modern comment/thread/people task on main, one owned
local Conventional Commit, no push or release. Later tasks remain pending. The
independently modified pipeline plan and historical evidence are not owned.
Product logic stays in packages/docx; existing safe-bash adapters call the same
SDK. No README changes, native reference build, downloaded unit assets, ambient
product I/O or networking.

## Verified standards and identity mapping

Read root/scoped instructions, docs/specs/docx.md, office-cli.md, office-sdk.md,
the API audit and the parsed schema-v2 API inventory. The pinned MS-DOCX revision
is 23.0, v20260818 (2026-08-18). Rechecked the existing local PDF SHA-256 against
standards-sources.json:
`fc991c9a15ae1e6d931bc6ecfd854f11b94c625dc8f1cb7041bcf14f28378a0f`.
The publisher's [current register](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-docx/b839fe1f-e1ca-4fa6-8c26-5954d0abbccd)
agrees with this revision. Retained research files under
/tmp/docx-standards-20260913 were read, not rebuilt or redistributed.

| Part / root / entry | Namespace | Verified semantics |
| --- | --- | --- |
| commentsExtended / commentsEx / commentEx | http://schemas.microsoft.com/office/word/2012/wordml | §§2.1.2, 2.5.3.1–2: paraId identifies the last comment paragraph; paraIdParent identifies the parent comment's last paragraph; done records resolution. |
| commentsIds / commentsIds / commentId | http://schemas.microsoft.com/office/word/2016/wordml/cid | §§2.1.4, 2.8.3.1–2: last-paragraph paraId maps to durableId; durableId is eight hex digits, greater than zero and less than 0x7FFFFFFF. |
| commentsExtensible / commentsExtensible / commentExtensible | http://schemas.microsoft.com/office/word/2018/wordml/cex | §§2.1.5, 2.10.3.1–2: durableId links the entry; dateUtc preserves explicit UTC date information; intelligentPlaceholder is a follow-up and cannot be present on replies. extLst remains opaque. |
| people / people / person | http://schemas.microsoft.com/office/word/2012/wordml | §§2.1.3, 2.5.3.4–6: person author must match at least one comment/revision author; presenceInfo carries providerId/userId. |
| Nested commentEntityInfo | http://schemas.microsoft.com/office/word/2026/wordml/cei | §§2.14, 5.10: CT_CommentEntityInfo entityType and nested extLst are inventoried, preserved, and not semantically edited. It is not a fifth standalone part. |

Paragraph identity uses w14:paraId in
http://schemas.microsoft.com/office/word/2010/wordml (§2.6.2.3).
Paragraph IDs must be greater than zero and less than 0x80000000.
Classic w:id, paragraph paraId and durableId are separate identifier domains.
Hex identity comparison is case-insensitive; stored spellings remain unchanged.

All four content types use
`application/vnd.openxmlformats-officedocument.wordprocessingml.<part-kind>+xml`.
Relationship URIs are respectively:

- http://schemas.microsoft.com/office/2011/relationships/commentsExtended
- http://schemas.microsoft.com/office/2016/09/relationships/commentsIds
- http://schemas.microsoft.com/office/2018/08/relationships/commentsExtensible
- http://schemas.microsoft.com/office/2011/relationships/people

The pinned standard gives vocabulary/semantics; supplementary packaging constants
were checked in the official Open XML SDK generated declarations for
[commentsExtended](https://raw.githubusercontent.com/dotnet/Open-XML-SDK/main/generated/DocumentFormat.OpenXml/DocumentFormat.OpenXml.Generator/DocumentFormat.OpenXml.Generator.OpenXmlGenerator/Part_WordprocessingCommentsExPart.g.cs),
[commentsIds](https://raw.githubusercontent.com/dotnet/Open-XML-SDK/main/generated/DocumentFormat.OpenXml/DocumentFormat.OpenXml.Generator/DocumentFormat.OpenXml.Generator.OpenXmlGenerator/Part_WordprocessingCommentsIdsPart.g.cs),
[commentsExtensible](https://raw.githubusercontent.com/dotnet/Open-XML-SDK/main/generated/DocumentFormat.OpenXml/DocumentFormat.OpenXml.Generator/DocumentFormat.OpenXml.Generator.OpenXmlGenerator/Part_WordCommentsExtensiblePart.g.cs), and
[people](https://raw.githubusercontent.com/dotnet/Open-XML-SDK/main/generated/DocumentFormat.OpenXml/DocumentFormat.OpenXml.Generator/DocumentFormat.OpenXml.Generator.OpenXmlGenerator/Part_WordprocessingPeoplePart.g.cs).
Only format constants were consulted; no implementation or substantial source
material was derived, so no new legal notice is required.

## Implemented boundary

- Admission recognizes the four expanded extension roots instead of incorrectly
  requiring their namespace to be classic WordprocessingML. Strict/Transitional
  dialect checks still apply to the document. Extension vocabulary is not added
  to the global understood-namespace profile.
- comments.list/get retain `modern: "preserve" | null` for compatibility and add
  `extensions: readonly CommentExtensionInfo[]`. Each item includes actual part,
  kind, namespace and preorder entries with child-index path, expanded element
  names and expanded attributes. IDs, reply/resolution, UTC date, people, nested
  entity metadata and unknown newer attributes are visible without side effects.
  Existing general inspection still inventories parts/content types/relationships.
- The four recognized parts require matching root/type and one internal owning
  main-document relationship before synchronization. Nonstandard/unknown storage,
  duplicate or dangling identities, ambiguous paragraph ownership and reply
  cycles reject affected comment operations. Unknown root content rejects because
  ownership cannot be established. Reads remain preservation inventory.
- A single-paragraph comment text edit replaces its admitted text runs, retaining
  the original paragraph and attributes. paraId, durableId, paraIdParent, done,
  dateUtc, author/initials/timestamp and extension bytes do not change. Both parent
  and reply text are editable. Unknown paragraph attributes survive untouched;
  affected unknown run content, embedded note markers and follow-ups reject.
  A selected w14:textId also refuses text assignment: §2.6.2.4 defines it as a
  paragraph version whose same paraId/textId should retain identical text across
  documents sharing docId. Version reassignment is not implemented here.
- Multi-paragraph whole-comment replacement with modern metadata rejects: this
  task does not infer a new last-paragraph identity or rewrite thread links.
- Removal deletes exactly selected bodies/anchors and their associated verified
  commentEx/commentId/commentExtensible nodes. A surviving reply prevents deletion
  of its parent; explicit all-selection may delete the entire thread. People are
  removed only when their selected author has no remaining recognized comment or
  revision owner; an unverified possible owner refuses cleanup. Shared people and
  their payload bytes remain unchanged. Unknown affected person data refuses.
- Unknown attributes/children on affected metadata entries, extLst/entity payloads,
  placeholders and unsafe classic bodies refuse deterministically before output.
  Unknown metadata on other identified comments stays exact. Empty extension
  parts, relationships and content-type declarations are retained.
- Unrelated body text replacement preserves all comment/extension part bytes,
  including unknown newer attributes. No downgrade, thread authoring, resolution
  setter, identity reassignment, entity edit or complete live model is advertised.

## Exact JS/security mapping and documentation drift

The utility retains existing async inspectDocumentComments/editDocumentComments
and plural comments.list/get/add/set/remove, closed camelCase operation options,
1-based ordinal --comment selectors, fingerprinted --select, --all, --dry-run,
publication controls and shared JSON/errors. CLI calls these SDK implementations.
New inventory is readonly JS arrays and JSON strings; paths are zero-based XML
child indexes. Classic comment_id stays a nonnegative safe JS number; paragraph
and durable identifiers remain strings, with no cross-domain numeric coercion.
No ambient clock, user identity, host files, network, native application, dynamic
XML execution or arbitrary method dispatch is introduced. Budgets and existing
publication checks apply before bytes reach the sink. Unsupported edits map to
code unsupported-edit, exit 1, affected 0, data null; usage remains 2.

The 920-row historical API inventory remains intact. Comment/Comments model
members, Document.comments/add_comment, Run.mark_comment_range and inherited
CommentsPart/DocumentPart/block/collection/helper APIs retain planned or mapped
obligations. No enum/helper, inherited member or public underscore-prefixed type
is excluded or promoted by this utility task. Neutral model method names remain
snake_case; this task adds no aliases. Planned Comment.timestamp remains copied
UTC Date | null with whole-second serialization, while utility timestamp/dateUtc
inventory is stored text. Planned Comments.get(comment_id) returns null when
absent; utility get uses explicit selection errors. Collection iteration/length
maps to Symbol.iterator/.length, with 0-based JS arrays separate from CLI ordinals.

Existing documentation-error dispositions remain: comment_id/timestamp replace
erroneous id/date examples; Paragraph owns add_run; Comments has no paragraphs
member. The older classic-comment milestone's blanket preserve-only statement is
historical, now superseded only by this verified synchronization subset. The
current spec introduction, audit and capabilities point to this narrower boundary.
No whole-public-API conformance claim is made and later tasks remain pending.

## Test-first evidence and agent QA procedure

Original classic-comment tests are unchanged. New original authored memfs cases
first failed on valid extension admission (13 failures), then on missing inventory
and blanket mutation refusal after admission was corrected (6 failures, 7 passes).
These initial outputs are retained in the session. Subsequent failing boundary
cases are retained in /tmp/docx-comment-extensions-boundary-red.log (3 failures:
missing capability disclosure, discarded paragraph metadata, embedded note marker)
and /tmp/docx-comment-extensions-author-red.log (unverified author ownership).
Final standards review added /tmp/docx-comment-extensions-id-red.log: three
out-of-range paragraph IDs were accepted before the explicit range guard; the
maximum legal value remains admitted without lexical normalization.
The additional /tmp/docx-comment-extensions-version-red.log reproduced retaining
a stale textId on text mutation; that affected edit now refuses.
All unit mutations use memfs; no downloaded file is needed to run regressions.

Execute the real optional shell adapter against original in-memory comments and
extension parts. Inspect help, edit a resolved parent, remove its leaf reply,
refuse a parent with a surviving reply, and list through a binary pipeline.
Compare original input bytes. Capture actual terminal output with terminal-png
and inspect the image; do not add a permanent QA script or screenshot test.

Run maintained DOCX workspace tests, lint and selected build closure; run portable
root export checks and existing safe-bash DOCX registration/integration tests.
Only owned source/tests/current evidence and this plan enter the local commit.
Disposable QA captures and the independently edited pipeline plan remain unstaged.

## Final verification

Verified on 2026-09-14:

- `npm run test --workspace=docx`: 75 files, 1,863 tests passed, including all
  29 new extension regressions and unchanged original comment tests.
  `/tmp/docx-comment-extensions-verified-tests.log`.
- `npm run lint --workspace=docx`: ESLint and both source/test TypeScript checks
  passed. `/tmp/docx-comment-extensions-verified-lint.log`.
- `npm run build:workspaces -- --workspace=docx`: maintained five-workspace build
  closure and native lifecycle stages passed.
  `/tmp/docx-comment-extensions-verified-build.log`.
- `node --import tsx --test --test-concurrency=1` over the existing DOCX
  registration test and all six DOCX integration files passed 52/52, zero skips.
  `/tmp/docx-comment-extensions-shell-tests.log`. Adapter files are unchanged.
- `npx vitest run scripts/docx-exports.test.ts`: both checks passed.
  `/tmp/docx-comment-extensions-exports.log`.
- Actual source-imported shell/memfs workflow verified help, reads, parent edit
  through a `.sh` file/binary pipe, leaf removal, parent refusal (exit 1), and
  whole-thread dry-run (exit 0), with unchanged input bytes. Inspected the complete
  unclipped `/tmp/docx-comment-extensions-qa.png`; captured output is also in
  `/tmp/docx-comment-extensions-qa.txt`. These captures are disposable evidence,
  not committed fixtures. The final ID/version guards do not change this valid
  workflow or its terminal output; their final unit regressions pass separately.
- `git diff --check` passed. Owned staging explicitly excludes the pre-existing
  pipeline plan edit and every temporary QA artifact.

Local commit only. No push, release, full document model, native layout fidelity,
thread authoring, paragraph-version reassignment or later task is claimed.

## Bounded verification correction — extension revision authors

Review of `ebf6a4140` on 2026-09-14 reproduced a people-cleanup defect:
the author census ignored annotation-author attributes on nonclassic elements.
Deleting the final comments removed the person still referenced by a surviving
w14:conflictIns or w14:conflictDel. An unknown extension carrying w:author was
also silently ignored. The pinned MS-DOCX PDF hash was reverified; §§2.6.1.3–6
define these conflict revisions using the classic track-change types, and
§2.5.3.5 retains the comment/revision author association.

Three original memfs regressions failed before the correction in
`/tmp/docx-comment-review-owner-red.log`: both conflict revisions lost their
person, and unknown ownership incorrectly published successfully. The census
now retains known conflict-revision authors and refuses cleanup for an unknown
element carrying the classic annotation-author attribute. This changes neither
revision content nor the understood-namespace profile. All 32 extension cases
then passed in `/tmp/docx-comment-review-owner-green.log`. The tests inspect
serialized people/document XML and empty publication on deterministic SDK
refusal, plus the shared CLI error envelope. Original tests remain unchanged.

The existing API mappings and historical inventory remain accurate for this
correction; no new model API or alias is introduced. Retained boundary, author,
ID and version red logs and later green logs were inspected. The earliest
admission/inventory red outputs described above are session-only evidence and
were not independently recovered during this review. The retained terminal
image and transcript were inspected; this is review of prior workflow QA,
not a new native-application or layout pass.

Final correction checks:

- `npm run test --workspace=docx`: 75 files / 1,866 tests passed;
  `/tmp/docx-comment-review-final-tests.log`.
- `npm run lint --workspace=docx`: ESLint and both TypeScript checks passed;
  `/tmp/docx-comment-review-final-lint.log`.
- `npm run build:workspaces -- --workspace=docx`: maintained five-workspace
  closure and lifecycle stages passed; `/tmp/docx-comment-review-final-build.log`.
- Existing DOCX registration and six adapter test files: 52 passed, zero skips,
  using `node --import tsx --test --test-concurrency=1`. These are integration
  checks; they do not independently cover comment extensions.
- `npx vitest run scripts/docx-exports.test.ts`: 2 passed. Export wiring is
  unchanged by the correction.
- New inline source-imported Shell/memfs QA verified both conflict revision
  cases through binary output and a comments-list pipe, retaining exact people
  and document bytes. Unknown extension ownership refused twice with exit 1,
  identical human diagnostics and zero binary output. Inputs stayed unchanged.
  Actual output and the inspected complete terminal screenshot are retained at
  `/tmp/docx-comment-review-qa.txt` and `/tmp/docx-comment-review-qa.png`.
- `git diff --check` passed. Only this plan, the extension census and its
  regression test file belong to the correction; no downloaded fixtures,
  unrelated pipeline-plan edits or README changes are included.

No native document renderer, repair-warning check, new downloaded-corpus
qualification or whole-public-model conformance was run or claimed. The earlier
session-only red evidence gap remains explicit above. Local commit only;
no push or release.

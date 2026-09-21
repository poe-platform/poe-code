# Bounded comment extension synchronization

Scope: inventory and preservation of modern comment metadata, verified classic
comment text/deletion synchronization, and deterministic refusal. Later tasks,
thread authoring and whole-public-API completion remain pending. Existing source,
names, tests and historical evidence are retained.

## Pinned standards and storage inventory

Authority: docs/docx/standards-sources.json and standards-coverage.md pin MS-DOCX
revision 23.0, v20260818 (August 18, 2026), PDF SHA-256
fc991c9a15ae1e6d931bc6ecfd854f11b94c625dc8f1cb7041bcf14f28378a0f.
The existing register records §§2.5/5.2, 2.8/5.4, 2.10/5.6 and 2.14/5.10.
No reference build, new download or renderer execution is required or claimed.

| Part kind/root | Namespace | Relationship URI | Identifiers/metadata |
| --- | --- | --- | --- |
| commentsExtended/commentsEx | http://schemas.microsoft.com/office/word/2012/wordml | http://schemas.microsoft.com/office/2011/relationships/commentsExtended | commentEx paraId, paraIdParent, done |
| commentsIds/commentsIds | http://schemas.microsoft.com/office/word/2016/wordml/cid | http://schemas.microsoft.com/office/2016/09/relationships/commentsIds | commentId paraId, durableId |
| commentsExtensible/commentsExtensible | http://schemas.microsoft.com/office/word/2018/wordml/cex | http://schemas.microsoft.com/office/2018/08/relationships/commentsExtensible | commentExtensible durableId, dateUtc, intelligentPlaceholder, opaque extension payload |
| people/people | http://schemas.microsoft.com/office/word/2012/wordml | http://schemas.microsoft.com/office/2011/relationships/people | person author, presenceInfo providerId/userId |

Each content type is application/vnd.openxmlformats-officedocument.wordprocessingml.
followed by its part kind and +xml (without the intervening newline).
Comment paragraph IDs use http://schemas.microsoft.com/office/word/2010/wordml.
Entity payload uses http://schemas.microsoft.com/office/word/2026/wordml/cei;
the pinned CT_CommentEntityInfo witness is nested metadata, not an additional
verified independent part descriptor. Inventory recursively reports expanded
names and attributes, including unknown newer payload, without interpreting it.

## Verified behavior and failing-tests-before-code

Existing original tests cover byte retention on unrelated edits, resolved parent
and reply text edits with unchanged IDs/resolution, leaf and whole-thread deletion,
durable-ID cleanup, shared/revision-owned people retention, opaque affected
metadata refusal, malformed IDs/cycles and surviving-reply refusal.

New original memfs cases validated unknown newer run/comment/paragraph attributes:
all already refuse through the shared XML mutation admission. No speculative
product change is made for them. Two new cases with original note bodies and
valid internal note relationships failed before code: comments.set silently
removed footnoteReference/endnoteReference from a modern reply and published the
candidate. The initial incomplete fixture had instead failed package validation;
adding the original note parts established the actual behavior before fixing it.
The synchronization preflight now uses the existing paragraph reference-marker
set and rejects the operation rather than discarding references. Repeated SDK
publication attempts emit zero bytes; CLI dry-run returns unsupported-edit,
exit 1, ok false, data null and affected 0. No silent downgrade is permitted.

## Exact JavaScript/security mappings and documentation drift

inspectDocumentComments and editDocumentComments remain always-async admitted
Uint8Array operations with explicit ArchiveContext/PublicationContext capabilities.
Extensions are readonly snapshots with zero-based XML paths and expanded names;
CLI comment ordinals are one-based and sorted by storage ID. The live model's
Comments.get uses storage IDs, not utility ordinals. Utility timestamps retain
stored strings; model timestamp remains Date|null. Explicit time/author, scoped
I/O, cancellation and bounded work replace ambient host authority. Common option
names remain camelCase in SDK JSON and mechanically kebab-case in CLI.
UnsupportedEditError carries unsupported-edit; no publication occurs on refusal.

The read upstream-api-audit.md and upstream-api-inventory.json retain historical
research dispositions. Neutral comment_id/timestamp spellings remain authoritative;
id/date, Comments.paragraphs and Comment.add_run guide drift remains a documented
error rather than new aliases. Comment/Comments, inherited rich containers,
part/element/package APIs, enums/helpers, collections and public underscore-prefixed
returns remain accountable under their existing scoped overlays; these utility
regressions do not establish whole-API completion. This document restores the
missing extension-plan target already linked by the spec and audit, without
rewriting historical evidence or modifying unrelated plans.

## Verification and owned delivery

Completed maintained checks:

- Focused comments/extension tests: 59 passed, including the two red-to-green cases.
- npm run lint --workspace=docx: ESLint and both TypeScript checks passed;
  one existing operation-types.test.ts unused-variable warning, zero errors.
- npm run build:workspaces -- --workspace=docx: maintained five-build dependency
  closure passed with the shared cache.
- npm run test --workspace=docx: 247 files / 5,152 tests passed, fresh execution.
- Owned diff whitespace check passed.

Only this plan and the owned comment-extension source/test files are committed
on main as one atomic fix. No push or release.
No human CLI rendering changes or screenshot tests are introduced.

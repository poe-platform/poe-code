# DOCX classic comments

Scope: F25 only, main, one owned local Conventional Commit. No push/release.
Later tasks, the independently edited pipeline plan and historical evidence stay
pending/untouched. No README additions or downloaded/native reference fixtures.

## Behavior and boundaries

The original package engine supplies `comments list/get/add/set/remove` to the
typed SDK and existing optional safe-bash adapter. Root remains export wiring.

- Noncreating list/get reads separate bodies from visible text. Default scope is
  comments; comments/all-stories narrow body queries. `--comment` is a one-based
  ordinal in numeric storage-ID order. Whole comment tokens detect stale sources.
  Get/set/remove require one comment, except explicit all on set/remove.
- Add requires a nonempty main-body paragraph range at existing run boundaries,
  including table cells. It spans intervening runs and preserves formatting,
  overlapping bookmarks, permission markers and XML annotations. One start, end
  and reference are emitted with a lowest-unused nonnegative ID. New parts,
  relationships and content types use collision-safe scoped names. Strict and
  Transitional inputs retain their dialect and original prefixes.
- Author/time are explicit, including empty author. Text/initials default empty;
  null initials omits the attribute, null text fails. No ambient identity/time/I/O.
- Partial runs, empty ranges, overlapping comments, header/footer/comment anchors,
  controlled/tracked content and fields reject. Field checks include boundaries
  spanning paragraphs; unrelated cached fields remain exact. Cross-paragraph and
  note/text-box anchor creation remain outside this bounded profile. Imported
  consistent classic ranges remain readable/removable.
- Set replaces plain paragraph bodies, retaining first-paragraph properties and
  author/initials/time/anchors. Additional plain paragraphs are removed. Tables,
  fields/images and annotated discarded paragraphs reject whole-body assignment;
  rich edits use existing scoped story editors.
- Remove deletes selected bodies/markers. Reference-only runs are removed;
  mixed runs retain neighbors and XML annotations. Deleted-anchor bodies remain
  discoverable/removable. Independent annotations inside a body block deletion.
  Empty parts/content types/outgoing relationships are conservatively retained.
- Reads report deleted-anchor/inconsistent/unsafe/overlapping ranges. Existing
  core admission rejects missing bodies and unmatched markers. Raw inactive XML
  references participate in safety. Modern metadata remains preserve-only;
  existing comment set/remove rejects when modern metadata is present.
- Existing publication identity/alias/capability checks and lowerable budgets
  apply. Dry-run publishes nothing. Changes carry generation-one staged locations
  against the admitted source; removals have null after-locations. Reopen output
  to acquire fresh generation-zero tokens. Comment batch execution is pending.

## Exact JS/security mappings and documentation drift

Read root instructions, the DOCX/shared CLI/shared SDK contracts, API audit and
parsed schema-v2 inventory. Historical model statuses are not promoted by these
utility tests. No public underscore-prefixed type is excluded.

| Surface | Mapping/status |
| --- | --- |
| Utility reads | Implemented `inspectDocumentComments(input: Uint8Array, request: CommentReadRequest, context: ArchiveContext): Promise<CommentReadData>`; comments.list/get discriminators and closed options. |
| Utility edits | Implemented `editDocumentComments(input: Uint8Array, request: CommentEditRequest, context: PublicationContext): Promise<CommentEditData>`; comments.add/set/remove discriminators, explicit publication identity/encoding/sinks. |
| Values | Readonly snapshot arrays, zero-based JS indexing/length/iteration; `comment_id: number`, author string, initials string/null, timestamp string/null, text, location, nullable start/end/reference addresses and issues. Utility timestamp is stored XML text for JSON, distinct from a live model Date. CLI ordinals are one-based; storage IDs are safe nonnegative integers. |
| Comments model | `add_comment(text = "", author = "", initials: string \| null = ""): Comment`, with explicit context time; `get(comment_id: number): Comment \| null`; length and Symbol.iterator remain planned/language-mapped. Utility missing get is a selection error, not the planned keyed model lookup. |
| Comment metadata | Read-only `comment_id: number` and `timestamp: Date \| null`, author string and initials string/null accessors remain planned. Model dates map to copied UTC Date values with whole-second serialization; no id/date aliases. |
| Comment blocks | `add_paragraph(text = "", style: string \| ParagraphStyle \| null = null): Paragraph`; `add_table(rows: number, cols: number, width: Length): Table`; `iter_inner_content(): IterableIterator<Paragraph \| Table>`; paragraphs/tables collections and read-only text remain planned. |
| Document/Run model | Document.comments, Document.add_comment(runs: Run \| readonly Run[], text = "", author = "", initials = "") and Run.mark_comment_range(last_run: Run, comment_id: number) remain planned; owner/run order must replace private wrapper/mock identity. |
| Inherited/package views | Comment.part, inventoried CommentsPart/DocumentPart members, inherited block methods, relationship collections, bounded XML/byte views and image/style helpers retain their existing security-mapped obligations. Supplied VFS/bytes replace ambient paths; no arbitrary loader or method dispatch. |
| Errors/CLI | Usage 2; invalid package/unsafe edit/missing/ambiguous/stale selection 1; publication/I/O 3; limits 4; cancellation 130. Plural commands and shared envelopes/options/schemas; batches and complete live models remain pending. |

The documentation-error rows for Comment.id/date, Comments.paragraphs and
Comment.add_run remain errors: Paragraph owns add_run. Other inherited members,
enums, helpers, collections and later tasks retain their existing obligations.
The utility snapshots do not impersonate a live Comment model.

Standards evidence: existing register F25 pins ECMA-376 Part 1 §17.13.4,
CT_Comments/CT_Comment and separate modern namespaces. No new certification,
substantial source copying or legal-notice change is claimed. Original fixtures
and existing standalone notices remain independent of downloads.

## Test-first evidence and QA procedure

Initial 9 regressions failed before code: missing SDK exports, unsupported CLI
operations and discovery. Further red cases covered disjoint comments in one
paragraph, overbroad help, staged generation and plain multi-paragraph assignment.
The latter red log is `/tmp/docx-comments-body-red.log`; earlier failures remain
in the session. Original tests are retained; discovery inventories add five paths
and F25. Unit mutations use memfs.

Execute the actual optional shell/command engine against original memfs input:
show help, add a comment, pipe binary bytes through get/set/remove, inspect missing
selection/time errors and verify input preservation. Capture actual terminal
output with terminal-png and inspect its PNG. This is an agent-executed procedure,
not a permanent QA script/screenshot test. DOCX is not a root poe-code subcommand.

Run maintained DOCX workspace tests/lint/build closure, portable root export
checks and existing safe-bash DOCX integration/registration. Disposable capture
logs/screenshots are excluded from the commit.

## Final verification

Verified on 2026-09-14 after the final schema/selector changes:

- `npm run test --workspace=docx`: 74 files, 1,832 tests passed, including 17
  original comment regressions. `/tmp/docx-comments-verified-tests.log`.
- `npm run lint --workspace=docx`: ESLint and source/test TypeScript passed.
  `/tmp/docx-comments-verified-lint.log`.
- `npm run build:workspaces -- --workspace=docx`: maintained five-workspace
  build closure and native postbuild passed. `/tmp/docx-comments-verified-build.log`.
- Existing safe-bash DOCX integration plus registration: 52 tests passed,
  no skipped cases. `/tmp/docx-comments-shell.log`.
- `npx vitest run scripts/docx-exports.test.ts`: both portable export checks
  passed. `/tmp/docx-comments-exports.log`.
- Actual memfs shell `.sh` workflow and binary pipelines verified add/set/get,
  add/remove/list, exit 1 for missing selection, exit 2 for missing time and exact
  unchanged input. `/tmp/docx-comments-cli.txt` and its PNG retain that evidence.
- Inspected `/tmp/docx-comments-help-final.png`: final add/get help shows the
  bounded selectors and comment scopes without clipping. This supersedes the
  older help portion of the workflow screenshot; workflow results stay unchanged.
- `git diff --check` passed. Only owned source/tests/spec/audit/plan files enter
  the local commit; disposable QA captures and the independent pipeline edit do not.

No native Word/page-layout rendering, large downloaded-corpus qualification,
modern/threaded semantic editing, complete live model or release is claimed.

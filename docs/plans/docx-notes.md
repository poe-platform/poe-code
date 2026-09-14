# DOCX footnotes and endnotes

Scope: F24 only, on main, one owned local Conventional Commit. No push or release.
Later tasks remain pending. Preserve the independently modified pipeline plan,
original tests and all historical evidence. No README additions.

## Implemented behavior

`notes list/get/add/set/remove` use the same typed package engine from the SDK and
the optional safe-bash command. Root exports remain wiring only. Product code has
no ambient filesystem, clock, identity, network, native reference execution or
downloaded fixtures. Unit mutations use original small fixtures and memfs.

- List defaults to both kinds; get/set/remove default to footnotes. Explicit
  `kind` or footnotes/endnotes scope narrows the owner. `all-stories` includes both
  kinds. One-based note ordinals are positions, not stored IDs. Tokens identify
  either note stories or individual reference annotations, including two in one run.
- Add requires kind and a whole body paragraph, including a paragraph in a table
  cell. It appends a reference and creates a marker-bearing note story. Text
  defaults empty. Controlled/tracked wrappers and enclosing simple/complex fields
  reject, including empty paragraphs inside spanning fields.
- New normal IDs start at the lowest unused positive integer within their own
  kind. Imported normal ID zero remains valid. Special bodies are identified by
  type rather than guessed numeric IDs. Missing separator and continuationSeparator
  bodies are created at -1 and 0 if free, otherwise at unused positive IDs.
  Existing special IDs/content and continuationNotice entries remain intact.
- Set text replaces simple paragraph content, retaining the first paragraph's
  properties and required note markers. Additional plain paragraphs are removed.
  Tables, images, fields and opaque affected content reject whole-note replacement;
  use existing scoped paragraph/run/table/text operations to edit rich stories.
  Original regressions exercise paragraph/table insertion and text replacement in
  note bodies containing multiple paragraphs, tables and original bitmap media.
- Shared-body text assignment requires `shared:true`. Removing one selected
  reference does not delete the body while any other raw reference remains.
  `reference:N` selects one reference in the selected note's census; a reference
  token selects the exact occurrence. `references:single|all` defaults single for
  a selected note. `all:true` selects all notes and references unless an explicit
  single policy is supplied; that policy still rejects ambiguous shared removal.
  Unsupported/inactive selected references reject before publication.
- The raw reference census includes inactive compatibility branches and other XML
  parts. Note bodies with independent bookmark/review/permission ownership remain
  retained after the last note reference disappears. Media and outgoing relationships
  are preserved conservatively; note removal is not resource garbage collection.
- `renumber:preserve|document-order` on add/remove defaults preserve. The explicit
  document-order policy remaps storage IDs using final staged reference order,
  deduplicates shared references, places unreferenced bodies last and excludes
  every special ID. Every reference must be editable before IDs can be remapped.
  It changes storage identifiers, never evaluates displayed numbering or pagination.
- Numbering inspection reports document defaults and effective per-section
  format/start/restart rules. Existing settings and section XML are unchanged.
  Continuous, eachSect and eachPage policies remain distinct; page restarts cannot
  be calculated without layout. Custom reference marks are retained as stored XML.
- Duplicate/missing IDs, unresolved references and invalid note types fail before
  publication. Reads do not materialize parts. Mutation publication uses the
  existing guarded transaction, lowerable budgets, cancellation and binary sinks.
  Deleted bodies have null after-locations; surviving shared bodies keep a staged
  story location. Result arrays are snapshots, not live model objects.

## Exact JS/security mappings and documentation drift

Read root/scoped instructions, docs/specs/docx.md, office-cli.md, office-sdk.md,
the API audit and every parsed schema-v2 inventory record. The pinned 920-object
inventory contains no footnote/endnote-specific public model owner/member; the
built-in style enum includes related style names. F24 is an additive utility
obligation. Historical inventory statuses are not promoted by utility tests.

| Contract | Mapping |
| --- | --- |
| Reads | `inspectDocumentNotes(Uint8Array, NoteReadRequest, ArchiveContext): Promise<NoteReadData>`; discriminated notes.list/get requests and noncreating reads. |
| Edits | `editDocumentNotes(Uint8Array, NoteEditRequest, PublicationContext): Promise<NoteEditData>`; discriminated operation-specific closed options and injected publication capabilities. |
| Values | Owned Uint8Array bytes; safe integer IDs; readonly JS arrays with zero-based indexing/length/iteration. One-based CLI ordinals are separate. Omitted options keep documented defaults; null/coercions/accessors/unknown fields reject. |
| Shared ownership | Exact reference tokens, explicit shared text editing and explicit reference cardinality. Unaddressable raw references participate in safety decisions without fabricated location tokens. |
| Model names | Neutral snake_case names are unchanged. Inherited members, enums/aliases, helpers, collections and publicly documented underscore-prefixed types keep their existing separate obligations. None are hidden or newly declared implemented. |
| Numbering | Typed plain metadata snapshots; no counter, page-layout or field execution. Storage-ID policy is explicitly distinguished from visible numbering. |
| Errors | Existing usage/2, invalid-package or unsupported/selection/1, publication/3, limits/4 and cancellation/130. Output remains unpublished on failed preflight. |
| CLI/batch | Plural notes paths, common flags/tokens/scopes/envelopes and mechanically camelCase SDK options. Schemas include exact results and F24 support. Batch argument declarations retain envelopes and exclude outer publication fields; note batch execution and live model owners remain pending. |
| Drift resolution | The original spec's notes.list/set/remove lacked kind and the shared-reference/storage-ID policy flags. This milestone documents those additive options, exact bounded result records, rich-story editing boundaries and null removal locations without rewriting historical evidence. |

Standards evidence: the existing F24 register pins ECMA-376 Part 1 §17.11 and
CT_Footnotes/CT_Endnotes/CT_FtnEdn/CT_FtnEdnRef. Microsoft documentation describes
[numbering start and its default](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.numberingstart)
and gives a [positive-ID continuation separator example](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.continuationseparatormark).
These support distinguishing special type from conventional numeric placement.
No new schema certification, source copying or native reference build is claimed.
Original data and existing standalone legal notices remain unchanged.

## Test-first evidence and QA procedure

1. The safe-bash note workflow failed unsupported-profile before implementation.
   Core tests failed against the missing note implementation, then exposed an
   empty-part insertion conflict. No earlier note product implementation existed.
2. Expanded original regressions failed for extra empty paragraphs, single-token
   schema admission, duplicate reference locations and insertion inside a spanning
   field before their respective fixes. Rich paragraph/table insertion passed
   through existing primitives and did not justify additional product changes.
3. Independent adapter review added failing regressions for earlier insertion
   renumbering and all overriding an explicit single policy. Both are preserved
   in notes-boundaries.test.ts; fixes use final staged order and retain explicit intent.
   Final original regressions also failed for imported integer lexical forms in
   after-locations, caller option mutation across asynchronous acquisition and
   hyperlink-owned note-marker loss. Fixes retain numeric identity, admitted
   options and reject nested markers before whole-paragraph replacement.
4. Run maintained DOCX workspace tests/lint, selected build dependency closure,
   portable export tests and safe-bash DOCX integration/registration. Keep logs and
   screenshots disposable and outside the commit.
5. Manual visual QA: invoke the actual optional command engine with original memfs
   input; capture notes remove help, both kinds, shared-reference ambiguity, one
   removal and dry-run output. Render actual terminal output through terminal-png
   and inspect screenshots. DOCX is an optional shell plugin, not a root poe-code
   command; no root route is invented for screenshots.

## Verification

- Baseline inspected on main: 5f82de66e6569a07b671fdde71b5d02987a9cd90.
- `npm test --workspace=docx`: 73 files / 1810 tests passed before the final
  three regressions above. No original tests were removed or renamed.
- Final focused Vitest run: notes, note boundaries/discovery, existing discovery
  and paragraph editing passed, 5 files / 79 tests, including all three final
  regressions and the shared paragraph primitive's existing coverage.
- Safe-bash DOCX integration plus registration cohort: 52 tests passed. Its
  maintained normal-runner discovery assertion passed; the new note test is
  explicitly registered. The final note workflow rerun also passed.
- `npm run lint --workspace=docx`, the declared five-workspace build closure
  (`npm run build:workspaces -- --workspace=docx`) and rebuilt portable exports
  all passed after the final fix; portable exports passed both tests.
- Spec structure checker: passed with zero warnings. Shared contracts and the
  920-entry API inventory were read; historical statuses remain unchanged.
- Actual terminal help and workflow screenshots were inspected at
  `/tmp/docx-notes-help.png` and `/tmp/docx-notes-workflow.png`: readable output,
  shared-reference ambiguity, one-reference removal, dry-run replacement and
  endnote insertion behaved as expected. No native document rendering claimed.
- All fixture mutations used memfs. QA captures/logs are disposable, untracked
  artifacts; there were no downloaded fixtures, native reference builds or
  product networking. This milestone is one atomic owned commit on main, with
  no push or release. Later tasks remain pending.

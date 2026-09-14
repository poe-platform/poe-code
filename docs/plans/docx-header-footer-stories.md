# DOCX header and footer stories

Status: Implemented and verified locally. No push or release.

Scope: only the header/footer story task, on main. Inspected baseline
`ccf2181401ae2ccab701de590b199c8ccedae5b2`. The existing edits to
`docx-typescript-safe-bash.md` and other unrelated work are not owned here.
Later tasks remain pending.

## Implementation and behavior

The package owns `inspectDocumentStories` and `editDocumentStories`, exposed by
the optional command engine as `headers` and `footers` list/get/set/remove.
The root only reexports its existing package entry; the safe-bash adapter invokes
the same engine. Reads enumerate section/variant bindings without materializing
absent definitions. Get defaults to the default variant; list includes all three.
Records include effective part, linked state, source section, all section owners,
cached text and revision-bound locations. Missing definitions have empty text,
null part/source section, empty owners and a section location.

Set requires text or link-to-previous intent. Text on an inherited or shared
definition requires `shared:true` or `linkToPrevious:false`. Shared edits include
every section owning the part, including other variants and owners outside the
selection. Local edits clone the complete part in its existing directory, copy
its relationship part without changing scoped IDs/targets, and rebind only the
selected occurrence. The immediately following inherited section is pinned to
its former effective definition (an empty definition if originally absent), so
later content does not change. Physical linkage may change to preserve that
effective content; this is distinct from a shared edit's affected sections.

Relinking deletes the selected local binding and exposes the previous section's
definition. The first section cannot link backward. Explicit remove deletes a
local binding, including in the first section; removal of an already inherited
binding fails unless allowEmpty. A relationship is removed only when its ID is
no longer referenced in the main XML. Its story and relationship parts are
removed only when no incoming package relationship remains. Outgoing resources
are retained conservatively, including media used by the body/other stories.

Simple whole-story text assignment reuses paragraph text validation/serialization;
it does not silently discard fields, tables or opaque blocks. Localized rich
stories reuse existing paragraph/run formatting and literal text operations,
including table-cell text, plus existing logical table/image locations and shared
image-resource queries. Cloning retains PAGE instructions/cached results and
media bytes; fields are never executed. General table construction/editing,
image insertion/replacement/layout, field authoring and the complete live model
remain later tasks, not claims made by these story bindings.
The first paragraph retains properties, XML comments and bookmark/annotation
markers; deletion that would lose markers in later paragraphs is rejected.

## Exact language/security mappings and drift

Read root and scoped instructions, the DOCX/Office CLI/Office SDK specifications,
the API audit and the header/footer, Section/Sections and inherited inventory
records. Historical inventory rows are preserved, not rewritten as passing
execution evidence. No reference runtime, native reference build or downloaded
fixture is used; original tests use memfs and authored XML/technical bitmap data.

| Public contract | Exact JavaScript disposition |
| --- | --- |
| `_Header`, `_Footer` | Public, owner-bound types remain recorded despite underscores. This utility task does not claim live constructor/owner identity or instantiate an unrestricted XML wrapper. |
| `is_linked_to_previous` | Planned synchronous boolean property retains its spelling; absence of a direct definition means true even in section zero. Model false materializes, true removes the definition. CLI linkToPrevious is an explicit boolean; first-section true is usage, and local isolation pins downstream effective bindings. No null/number coercion. |
| `Section.header/footer`, `first_page_header/footer`, `even_page_header/footer` | Six distinct planned live owners. Utility variant strings default/first/even are not new model aliases. Reads are noncreating; documented creating model content access remains pending. |
| Header/footer index enum | `WD_HEADER_FOOTER_INDEX.PRIMARY = 1`, `FIRST_PAGE = 2`, `EVEN_PAGE = 3` map to default/first/even. Retain neutral enum identities and registered aliases; this operation uses closed variant strings, not arbitrary numeric casts. |
| Inherited `add_paragraph(text='', style=null)` | Planned synchronous Paragraph return; nullable style preserves inheritance. Existing utility paragraphs.add works after explicit localization, including empty paragraph creation; it is not a claim of live Paragraph handles. |
| Inherited `add_table(rows, cols, width)` | Planned synchronous Table return with required Length; table collections and rich traversal remain public pending obligations. Existing table/cell locations and literal text replacement work in cloned stories. General table editing remains pending. |
| `paragraphs`, `tables`, `iter_inner_content()` | Planned live zero-based collections, length and Symbol.iterator; paragraph/table traversal keeps XML order. Utility locations use one-based selectors and snapshot tokens. They are not interchangeable with model collection indexes. |
| `part` and returned package/XML views | Planned owner-bound safe views; existing package graph exposes bounded bytes/content types/scoped relationships. No raw dependency API, arbitrary XPath, dynamic invocation or host access. |
| Admission and publication | Always async over owned Uint8Array and explicit filesystem/sink capabilities. Deterministic new-part timestamps; no ambient clock, filesystem, fonts, identity or network acquisition. External relationship targets remain inert data. |
| Errors | Closed/invalid intent uses usage/exit 2. Missing, ambiguous and stale selection, unsupported edits and semantic validation use exit 1. I/O/publication 3, limits 4, cancellation 130 retain shared codes; no failed edit publishes candidate bytes. |
| D09 documentation drift | Historical text denying header editing is obsolete and does not narrow the API. This task supplies bounded utility editing; it does not promote all Section or inherited model members. |
| Deletion contract gap | The direct register lacked a way to remove an initial definition because link-to-previous true is invalid there. Add explicit headers.remove/footers.remove with section/variant selection and normal publication. Existing names remain unchanged. |

## Test-first evidence and QA procedure

1. Initial original regressions failed before implementation because the two
   story APIs did not exist (11 failures). CLI regressions then failed with
   unsupported-profile before command dispatch/discovery were implemented.
2. Subsequent red regressions exposed multiple insertions at one XML offset,
   variant-token mismatch, unchanged plain-text reporting, implicit-final result
   paths, effect-free/all-section intent, misleading help options/scope, escaped
   human newlines, and paragraph annotation loss. Each fix follows its observed test.
3. Test both dialects, all six variants, shared explicit and inherited bindings,
   downstream isolation, relinking/removal, missing reads, fields and media.
   Independently reopen small ZIPs and assert OPC links/resource bytes.
4. Execute actual safe-bash Shell commands over the existing memfs publication
   fixture, including in-place edits, output destinations, dry-run, scoped
   paragraph/text operations and exact preservation after failure.
5. Run maintained DOCX test/lint/build closure, focused safe-bash DOCX tests,
   portable export checks and spec checker. Inspect help/output screenshots
   using the maintained terminal renderer and the optional Shell plugin.
6. Commit only explicitly owned files as one interdependent Conventional Commit.
   Preserve original tests, historical evidence and unrelated changes. No push.

## Verification

Verified on 2026-09-14 against the owned working tree:

- `npm test --workspace=docx`: 56 files, 1,455 passing tests. Original names and
  tests remain; 22 original story utility/command regressions were added.
- `npm run lint --workspace=docx`: passed ESLint, source TypeScript and test
  TypeScript. A discriminated test-helper request required a type assertion after
  narrowing the story-specific public options; no product type failure remains.
- `npm run build:workspaces -- --workspace=docx`: passed the maintained five-build
  selected dependency closure and native postbuild checks.
- `node --import tsx --test packages/safe-bash/tests/commands/docx/*.test.ts`:
  all 25 tests passed, including four appended original actual Shell story cases.
- The maintained `integration-inputs.test.mjs` test named
  `default normal runner passes every discovered active file` passed, retaining
  the existing exact registration of the extended section/story test file.
- `npm exec vitest run scripts/docx-exports.test.ts`: both checks passed, including
  the browser/worker bundle closure. Final focused story/command/export recheck:
  24 tests passed after tightening negative assertions to exact stable codes.
- The write-spec checker passed `docs/specs/docx.md` with zero warnings;
  `git diff --check` passed. The full specification retains Proposed status and
  Implemented Through: Not applicable; a bounded milestone is not full conformance.
- The maintained generic `npm run screenshot` renderer captured actual optional
  Shell help and workflow output using the original memfs fixture. The root CLI
  does not expose this optional docx command, so screenshot-poe-code cannot drive
  it without unrelated wiring. `/tmp/docx-story-shell-visual-final.png` was
  inspected: applicable options only, correct header scope, real paragraph
  newlines, successful edits and expected rejection without explicit shared/local
  intent. The initial failing screenshot and corrected intermediate screenshot
  remain separate disposable QA evidence; none is staged.

The broad DOCX check initially exposed three expected discovery inventory changes;
the existing assertions were updated additively for the new paths and F17 subset.
Earlier red cases and screenshot findings are recorded above, not erased or
counted as passes. No full-root/full safe-bash check, document rendering, large
downloaded corpus coverage, complete model parity, remote delivery or release is
claimed. No README, historical API inventory or unrelated queue change is staged.

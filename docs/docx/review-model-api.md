# Review model API evidence

The original memfs tests initially failed because review-model.js was absent.
Seven original cases now pass (13 ms test execution): comment identity/date copy,
missing lookup, editable author/nullable initials, rich paragraph/table ordering,
creation with deterministic admitted time, hyperlink run/target distinctions,
detached page-break fragments including whole hyperlink extraction, boundary null
fragments and UTC timestamp lexical validation. The timestamp regression was
observed failing before applying the shared UTC instant validator.

## JS and security mapping

- Comments is iterable with length and get(comment_id), returning null on missing IDs.
  add_comment accepts omitted text/author/initials as empty strings; null text rejects.
- Comment exposes comment_id and UTC Date-valued timestamp read-only; each Date
  read is a fresh object. Author is mutable; null initials removes the attribute.
  It owns add_paragraph/add_table and ordered iter_inner_content, paragraphs and
  tables. Paragraph owns add_run; neither Comment.add_run nor Comments.paragraphs exists.
- Public inherited part and owner-bound element access retain package identity.
  Rich block edits use the root model store and existing format editing engines.
- Hyperlink runs are owner-bound; text ignores cached breaks. Address remains raw
  relationship target data; fragment is separate. URL appends the separate anchor
  only when address is nonempty. Internal fragment-only links have empty URL.
  Reads perform no network or host I/O. History remains separate stored state.
- RenderedPageBreak describes existing cached metadata only. Its preceding and
  following paragraph fragments are detached, preserve paragraph properties and
  return null when no fragment content exists. Breaks inside hyperlinks place the
  entire hyperlink before the split. Fragment queries do not mutate source XML.

Guide id/date examples are documentation errors; no aliases are introduced.
The JSON utility representation retains timestamp strings while the live API
returns Date values. Shared CLI routes, schema/capabilities and range creation
are root integration responsibilities, and remain unclaimed by these unit cases.

## Completed integration evidence

Fourteen review-model cases pass, including real admitted document publication
into memfs, reopening rich paragraph/table/paragraph comments, and verifying
multi-paragraph range markers with the existing comments census. Five additional
closed batch registry cases pass: declaration/owner checks, resource selectors,
logical cell mutation, constructor-owned row/column collections, inherited table
owners, section sequence protocols, rich comment operations and physical-width
conversion from declarative Length values. Later cached break extraction rejects
until the first break is processed. The extracted marker is removed from a
detached whole-hyperlink fragment; source XML remains unchanged. Detached review
owners reject inherited part access. Relationship targets require the admitted
relationship namespace, correct external hyperlink type and story-relative owner.

The structure registry uses explicit fixed per-class member lists, exact declared
schema argument order and validated owner classes. It registers only declared
operation IDs. Declarative widths convert once through the shared EMU rounding
function into owned Length values. Shared formatting/package/enum actions remain
in their existing registry. Constructor-owned collections remain public.

Document neighboring inline_shapes/settings/add_heading/add_page_break/add_section
and Run neighboring iter_inner_content are not claimed
by this review agent's current bridge; their implementation and source-audit
status remain root-owned integration obligations. Source IDs and source guide
identities remain research evidence only; no reference identity is introduced in
product files or original test fixtures.

The real structure SDK/CLI integration initially reproduced an initialization
cycle (undefined registry owner prototype) before correction. Review metadata now
uses the pure namespace attribute accessor from section-properties, avoiding a
comments census dependency during public model initialization. Both real shared
SDK/CLI command tests and nineteen owned cases then passed (21 total).

A later public entry-order regression required lazy constructor providers in all
structure registry registrations; no constructor/prototype is inspected during
module initialization. The public index-first case queries schema/capabilities
then executes a declared structure operation. Primary header/footer types and
operation names are _Header/_Footer, with no invented Header/Footer aliases.

Seventeen review cases and six registry cases pass, along with two real command
cases (25 total). Additional original red regressions verify that final endpoint
run descendants cannot hide field/comment markers, an existing rich comment can
be anchored without allocating another body, and opaque rich blocks cannot shift
visible paragraph text. bindCommentRange and markCommentRange reuse one validator
and marker editor, with existing comment bodies/unique anchor IDs checked before
mutation. The root wraps these composite edits in the shared model transaction.

Root integration now supports Run.style and Run.mark_comment_range. Seven closed
registry tests and four real SDK/CLI command tests qualify the same owner paths.
See [integration evidence](live-model-integration.md) for final maintained checks.

## Exact scoped inventory overlay

Historical rows remain unchanged. Each of these 33 rows is accounted for by
original review tests, shared paragraph/run/document integration and the fixed
registry, including inherited part views and APIs lacking source tests.

| Inventory row | JavaScript mapping / disposition | Original evidence |
| --- | --- | --- |
| `docx.comments.Comments` | `Comments(admitted owner/ref binding)` | review-model.test.ts; document-model.test.ts |
| `docx.comments.Comments.add_comment` | `Comments.add_comment(...)` | review-model.test.ts; document-model.test.ts; closed registry |
| `docx.comments.Comments.get` | `Comments.get(...)` | review-model.test.ts; document-model.test.ts; closed registry |
| `docx.comments.Comment` | `Comment(admitted owner/ref binding)` | review-model.test.ts; document-model.test.ts |
| `docx.comments.Comment.add_paragraph` | `Comment.add_paragraph(...)` | review-model.test.ts; document-model.test.ts; closed registry |
| `docx.comments.Comment.add_table` | `Comment.add_table(...)` | review-model.test.ts; document-model.test.ts; closed registry |
| `docx.comments.Comment.author` | `Comment.author` | review-model.test.ts; document-model.test.ts; closed registry |
| `docx.comments.Comment.comment_id` | `Comment.comment_id: number (readonly)` | review-model.test.ts; document-model.test.ts; closed registry |
| `docx.comments.Comment.initials` | `Comment.initials` | review-model.test.ts; document-model.test.ts; closed registry |
| `docx.comments.Comment.iter_inner_content` | `Comment.iter_inner_content(...)` | review-model.test.ts; document-model.test.ts; closed registry |
| `docx.comments.Comment.paragraphs` | `Comment.paragraphs` | review-model.test.ts; document-model.test.ts; closed registry |
| `docx.comments.Comment.tables` | `Comment.tables` | review-model.test.ts; document-model.test.ts; closed registry |
| `docx.comments.Comment.text` | `Comment.text` | review-model.test.ts; document-model.test.ts; closed registry |
| `docx.comments.Comment.timestamp` | `Comment.timestamp: Date | null (readonly copies)` | review-model.test.ts; document-model.test.ts; closed registry |
| `docx.text.hyperlink.Hyperlink` | `Hyperlink(admitted owner/ref binding)` | review-model.test.ts; document-model.test.ts |
| `docx.text.hyperlink.Hyperlink.address` | `Hyperlink.address` | review-model.test.ts; document-model.test.ts; closed registry |
| `docx.text.hyperlink.Hyperlink.contains_page_break` | `Hyperlink.contains_page_break` | review-model.test.ts; document-model.test.ts; closed registry |
| `docx.text.hyperlink.Hyperlink.fragment` | `Hyperlink.fragment` | review-model.test.ts; document-model.test.ts; closed registry |
| `docx.text.hyperlink.Hyperlink.runs` | `Hyperlink.runs` | review-model.test.ts; document-model.test.ts; closed registry |
| `docx.text.hyperlink.Hyperlink.text` | `Hyperlink.text` | review-model.test.ts; document-model.test.ts; closed registry |
| `docx.text.hyperlink.Hyperlink.url` | `Hyperlink.url` | review-model.test.ts; document-model.test.ts; closed registry |
| `docx.text.pagebreak.RenderedPageBreak` | `RenderedPageBreak(admitted owner/ref binding)` | review-model.test.ts; document-model.test.ts |
| `docx.text.pagebreak.RenderedPageBreak.following_paragraph_fragment` | `RenderedPageBreak.following_paragraph_fragment` | review-model.test.ts; document-model.test.ts; closed registry |
| `docx.text.pagebreak.RenderedPageBreak.preceding_paragraph_fragment` | `RenderedPageBreak.preceding_paragraph_fragment` | review-model.test.ts; document-model.test.ts; closed registry |
| `docx.comments.Comments.__iter__` | `Comments[Symbol.iterator]()` | review-model.test.ts |
| `docx.comments.Comments.__len__` | `Comments.length` | review-model.test.ts |
| `docx.comments.Comment.part` | `Comment.part` | review-model.test.ts; document-model.test.ts; closed registry |
| `docx.text.hyperlink.Hyperlink.part` | `Hyperlink.part` | review-model.test.ts; document-model.test.ts; closed registry |
| `docx.text.pagebreak.RenderedPageBreak.part` | `RenderedPageBreak.part` | review-model.test.ts; document-model.test.ts; closed registry |
| `docx.comments.Comment.id` | `documentation error: no alias/member; verified comment_id/timestamp and rich paragraph operations` | API reconciliation; registry declaration checks |
| `docx.comments.Comment.date` | `documentation error: no alias/member; verified comment_id/timestamp and rich paragraph operations` | API reconciliation; registry declaration checks |
| `docx.comments.Comments.paragraphs` | `documentation error: no alias/member; verified comment_id/timestamp and rich paragraph operations` | API reconciliation; registry declaration checks |
| `docx.comments.Comment.add_run` | `documentation error: no alias/member; verified comment_id/timestamp and rich paragraph operations` | API reconciliation; registry declaration checks |

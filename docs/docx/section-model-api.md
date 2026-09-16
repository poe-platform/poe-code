# Live section model evidence

The bounded live Section/Sections and _Header/_Footer model preserves the primary
neutral snake_case property/method spellings. It includes section-owned ordered
paragraph/table traversal and all first/even/default header/footer slots.

| Surface | JavaScript mapping and behavior |
| --- | --- |
| Sections | Live iterable sequence, length, zero-based numeric properties and at, negative indexes, slice, count, index, includes and reversed |
| Section geometry | Typed immutable lengths, missing XML attributes return null, null clears only selected attribute |
| Section orientation/start | Retained enum values and aliases, nullable assignment clears storage, default portrait/new-page getters |
| First-page policy | Boolean setting distinct from the document-wide even/odd Settings policy |
| Section content | Paragraph/table document order partitioned by owning section; boundary paragraph belongs to ending section |
| _Header/_Footer | Rich block containers with paragraphs, tables, add_paragraph, add_table, iter_inner_content, part and element |
| Linked stories | Queries of linkage are noncreating; content/part getters create missing ancestor definition; explicit unlink creates blank local story |
| Utility reads | Existing sections/headers/footers inventory remains noncreating and uses one-based selectors |

Tests use original small XML archives and memfs. All mutation is delegated to the
shared owner's admitted archive/XML store and bounded public views. No native
runtime, host filesystem, implicit network or external fixture is part of the
model.

The audit's public underscore-prefixed container types remain represented by
_Header/_Footer; they are not hidden or excluded. Historical API/test inventory
counts are unchanged. The [owned implementation plan](../plans/docx-section-model-api.md)
records red-before-code, 27 passing original acceptance cases, passing owned
ESLint and the parent's integration of the shared typed registry. Final maintained
package checks and commit delivery remain parent-owned. Full document public API
and renderer/corpus conformance remain separate obligations.

## Exact scoped historical inventory overlay

This overlay accounts for all **45** pinned `docx.section.*` API records: four
owner types, 34 member records (including the three returned/inherited part
records) and seven sequence protocols. The authoritative denominator is the 45 rows
below, not a whole-format count. Historical JSON dispositions are unchanged.

Acceptance keys refer to original `section-model.test.ts` cases: S1 sequence and
section blocks; S2 initial nullable/enums/policy; S3 all six creating linked story
slots; S4 rich header/footer blocks and bounded views; S5 every geometry member,
all orientation/start symbols, null/zero/signed lengths and invalid values; S6
throwing ranged index; S7 style name/owned/null; S8 setter-created containers and
default-start removal; S9 lexical boolean forms and empty properties; S10 bound
public _Header/_Footer constructors with every story-index symbol.

| Historical source ID | Exact target signature | Mapping | Acceptance |
| --- | --- | --- | --- |
| `docx.section.Sections` | `Sections(store: ModelStore)` | sequence | S1/S6 |
| `docx.section.Section` | `Section(store: ModelStore, ref: ModelRef)` | owner-bound | S1 |
| `docx.section.Section.bottom_margin` | `Section.bottom_margin: Length | null (read/write)` | typed-property | S2/S5/S8/S9 |
| `docx.section.Section.different_first_page_header_footer` | `Section.different_first_page_header_footer: boolean (read/write)` | story-owner | S3 |
| `docx.section.Section.even_page_footer` | `Section.even_page_footer: _Footer` | story-owner | S3 |
| `docx.section.Section.even_page_header` | `Section.even_page_header: _Header` | story-owner | S3 |
| `docx.section.Section.first_page_footer` | `Section.first_page_footer: _Footer` | story-owner | S3 |
| `docx.section.Section.first_page_header` | `Section.first_page_header: _Header` | story-owner | S3 |
| `docx.section.Section.footer` | `Section.footer: _Footer` | story-owner | S3 |
| `docx.section.Section.footer_distance` | `Section.footer_distance: Length | null (read/write)` | typed-property | S2/S5/S8/S9 |
| `docx.section.Section.gutter` | `Section.gutter: Length | null (read/write)` | typed-property | S2/S5/S8/S9 |
| `docx.section.Section.header` | `Section.header: _Header` | story-owner | S3 |
| `docx.section.Section.header_distance` | `Section.header_distance: Length | null (read/write)` | typed-property | S2/S5/S8/S9 |
| `docx.section.Section.iter_inner_content` | `Section.iter_inner_content(): Iterable<Paragraph | Table>` | ordered-content | S1 |
| `docx.section.Section.left_margin` | `Section.left_margin: Length | null (read/write)` | typed-property | S2/S5/S8/S9 |
| `docx.section.Section.orientation` | `Section.orientation: WD_ORIENTATION (write also null)` | typed-property | S2/S5/S8/S9 |
| `docx.section.Section.page_height` | `Section.page_height: Length | null (read/write)` | typed-property | S2/S5/S8/S9 |
| `docx.section.Section.page_width` | `Section.page_width: Length | null (read/write)` | typed-property | S2/S5/S8/S9 |
| `docx.section.Section.right_margin` | `Section.right_margin: Length | null (read/write)` | typed-property | S2/S5/S8/S9 |
| `docx.section.Section.start_type` | `Section.start_type: WD_SECTION_START (write also null)` | typed-property | S2/S5/S8/S9 |
| `docx.section.Section.top_margin` | `Section.top_margin: Length | null (read/write)` | typed-property | S2/S5/S8/S9 |
| `docx.section._Header` | `_Header(section: Section, index=PRIMARY)` | rich-story | S3/S4/S7/S10 |
| `docx.section._Header.add_paragraph` | `_Header.add_paragraph(text="", style?: string | ParagraphStyle | null): Paragraph` | rich-story (inherited) | S3/S4/S7/S10 |
| `docx.section._Header.add_table` | `_Header.add_table(rows, cols, width: Length): Table` | rich-story (inherited) | S3/S4/S7/S10 |
| `docx.section._Header.is_linked_to_previous` | `_Header.is_linked_to_previous: boolean (read/write)` | rich-story (inherited) | S3/S4/S7/S10 |
| `docx.section._Header.iter_inner_content` | `_Header.iter_inner_content(): Iterable<Paragraph | Table>` | rich-story (inherited) | S3/S4/S7/S10 |
| `docx.section._Header.paragraphs` | `_Header.paragraphs: Paragraph[]` | rich-story (inherited) | S3/S4/S7/S10 |
| `docx.section._Header.tables` | `_Header.tables: Table[]` | rich-story (inherited) | S3/S4/S7/S10 |
| `docx.section._Footer` | `_Footer(section: Section, index=PRIMARY)` | rich-story | S3/S4/S7/S10 |
| `docx.section._Footer.add_paragraph` | `_Footer.add_paragraph(text="", style?: string | ParagraphStyle | null): Paragraph` | rich-story (inherited) | S3/S4/S7/S10 |
| `docx.section._Footer.add_table` | `_Footer.add_table(rows, cols, width: Length): Table` | rich-story (inherited) | S3/S4/S7/S10 |
| `docx.section._Footer.is_linked_to_previous` | `_Footer.is_linked_to_previous: boolean (read/write)` | rich-story (inherited) | S3/S4/S7/S10 |
| `docx.section._Footer.iter_inner_content` | `_Footer.iter_inner_content(): Iterable<Paragraph | Table>` | rich-story (inherited) | S3/S4/S7/S10 |
| `docx.section._Footer.paragraphs` | `_Footer.paragraphs: Paragraph[]` | rich-story (inherited) | S3/S4/S7/S10 |
| `docx.section._Footer.tables` | `_Footer.tables: Table[]` | rich-story (inherited) | S3/S4/S7/S10 |
| `docx.section.Section.part` | `Section.part: bounded XmlPartView` | bounded-part | S5 |
| `docx.section._Header.part` | `_Header.part: bounded XmlPartView` | rich-story (inherited) | S3/S4/S7/S10 |
| `docx.section._Footer.part` | `_Footer.part: bounded XmlPartView` | rich-story (inherited) | S3/S4/S7/S10 |
| `docx.section.Sections.__getitem__` | `Sections.at(index) / [index] / slice(start?, end?)` | sequence | S1/S6 |
| `docx.section.Sections.__iter__` | `Sections[Symbol.iterator]()` | sequence | S1/S6 |
| `docx.section.Sections.__len__` | `Sections.length: number` | sequence | S1/S6 |
| `docx.section.Sections.count` | `Sections.count(value): number` | sequence | S1/S6 |
| `docx.section.Sections.index` | `Sections.index(value, start=0, stop?): number` | sequence | S1/S6 |
| `docx.section.Sections.__contains__` | `Sections.includes(value): boolean` | sequence | S1/S6 |
| `docx.section.Sections.__reversed__` | `Sections.reversed(): IterableIterator<Section>` | sequence | S1/S6 |

All 45 rows have bounded original acceptance through the owner model, including
public `_Header`/`_Footer`, their inherited rich members and returned part views.
Constructor XML/part arguments map to admitted owner/ref bindings, and public
_Header/_Footer construction uses an owned Section and the retained index enum;
internal explicit strings default/first/even map to those same three slots.
`int | Length` geometry writes map to typed Length values rather than ambiguous
untyped integers; wrong types fail InputTypeError. Missing indexed values are
BoundsError, missing throwing index values InvalidValueError, detached owner
handles StaleHandleError. Source-object identity is owner-bound equality through
Section.equals and live collection membership; JS wrapper identity is not a
required source mock mechanic. _Header/_Footer do not gain an invented equals
member because the pinned classes have no public value-equality override.

The scoped test inventory contains **93** records in tests/test_section.py
(Sections 4; Section 64; base-story helpers 11; footer helpers 7; header helpers
7) and **36** section-guide scenarios in features/sct-section.feature. They are
research candidates, not 129 executed product tests. Their public semantic
variants reduce to the original acceptance keys above; dependency helper calls,
mock identity and exact incidental numeric values are not copied. The independent
original tests additionally cover inherited sequence protocols and rich container
members lacking direct section-file tests. This does not claim the entire
2,259-case test inventory has been executed or that all guide workflows outside
the delegated section scope are complete.

Direct utility routing remains sections.list/add/set and headers/footers
list/get/set/remove for established utility operations. The parent now declares live
rich-container creation/property routing in the versioned closed typed batch
registry, including inherited part access. Owned semantic cases verify indexed
collection selectors and captured physical widths through that registry. This
section-only evidence does not claim whole-public-API coverage.

The associated enum closure is separate from the 45 section-owner rows:
WD_ORIENTATION has PORTRAIT/LANDSCAPE (2), WD_SECTION_START has
CONTINUOUS/NEW_COLUMN/NEW_PAGE/EVEN_PAGE/ODD_PAGE (5), and
WD_HEADER_FOOTER_INDEX has PRIMARY/FIRST_PAGE/EVEN_PAGE (3). The neutral public
aliases WD_ORIENT, WD_SECTION and WD_HEADER_FOOTER remain the same exported
families. Owned acceptance exercises all 10 values; the maintained
public-enum-protocols.test.ts provides the existing exact alias/value/helper
contracts. No enum/helper row is subtracted because it lives outside
`docx.section.*`, and this owner overlay does not relabel historical enum counts.

The parent-requested shared-owner review additionally retains original regressions
for identical sibling replacement, lazy/existing style rollback, default getter
creation, unstyled noncreation, admitted named sequence selectors, repeated table
creation return ownership and stable package ownership after rollback. Mutable
batch width capture is independently verified. These are shared integration
cases outside the 45-row historical section-owner denominator; they do not alter
historical inventory counts. All 27 original cases now pass after root corrections, including the package
owner checkpoint. Owned ESLint passes; final maintained verification and commit
delivery remain the parent's responsibility.

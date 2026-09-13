# Live layout selection and synchronous slide insertion

`Presentation.slide_layouts` and `Slides.add_slide(slide_layout)` now execute the
basic original JavaScript slide creation workflow. This is bounded implementation
of those previously missing members, not completion of the layout/master/notes
object graph or the full 2,426-row public API denominator.

The package exports `SlideLayout` and `SlideLayouts`; `PresentationModel` exposes
`readonly slide_layouts: SlideLayouts`. The existing `Slides` collection exposes
`add_slide(slide_layout: SlideLayout): Slide`. These model spellings retain the
neutral documented names. No raw XML constructor is needed by callers.

## Shared behavior and ownership

The existing `addSlide` operation now admits input asynchronously, invokes the
synchronous `prepareSlideInsertion` implementation, and publishes the package.
That same implementation prepares model insertions against the admitted current
parts. All original layout matching, master registration, placeholder copying,
shape/slide/relationship ID allocation, graph validation and conditional/protected
structure checks remain in one implementation. A candidate graph is validated
before live state changes become visible.

The selector implementation similarly separates input admission from synchronous
`buildSelectionIndex`. Model insertion rebuilds the internal selection inventory
against current parts before committing, so subsequent table/chart/image methods
resolve the new slide. This does not expose a new token or fingerprint scheme;
external command selection still admits and fingerprints the package bytes.

The existing `Slides` object appends a new live `Slide` and retains all previously
returned slide and drawing handles. It uses the same slide owner factory as
loaded slides. A preparation or owner-construction failure restores the previous
change map and selection index. A successful append increments the model revision
for existing stale-publication checks. Pending generated chart workbooks survive
an append, and new slides can receive charts before serialization or async images.

`SlideLayouts` follows the first registered master's `sldLayoutIdLst` relationship
order. It does not alphabetize layout labels, use part filename order, or combine
all masters. The original default template supplies the existing neutral `Blank`
layout; no external template assets or new defaults were introduced. A missing
first master raises the neutral `IndexError` (`index-out-of-range`) on
`presentation.slide_layouts` access.

## Exact public mapping

| Source-facing behavior       | JavaScript mapping and limits                                                                                                                                   | Command counterpart                                                                                                                      |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| First-master layout sequence | `slide_layouts`, `.length`, checked zero-based numeric access, `.at(index)` with negative indexing, ordered `Symbol.iterator`; membership entries are read-only | `layouts list/get` exposes registered layout and owning master records; model first-master scope must be retained when comparing results |
| Name lookup                  | `get_by_name(name, default_value = null)` returns the first matching layout or the supplied typed `SlideLayout                                                  | null`; undefined selects null                                                                                                            | Layout-name selection and list inspection; no arbitrary object dispatch |
| Membership position          | `.index(slide_layout)` compares owned part identity, returns zero-based position and rejects a foreign member                                                   | Layout-list order is explicit; CLI display/slide selection remains one-based                                                             |
| Layout label                 | Synchronous `.name` read/write; null removes the name attribute and reads back as empty string; non-string/non-null fails with `invalid-type`                   | `layouts set --layout ... --name ... --scope layouts` uses the existing shared content editing behavior                                  |
| XML/package access           | `.element` returns the existing bounded `XmlElementView`; `.part` returns its owning `PartView`                                                                 | Existing declared XML/package views remain bounded; this does not add unrestricted layout XML editing                                    |
| Slide insertion              | `slides.add_slide(slide_layout)` is synchronous, appends, returns the live `Slide`, and clones eligible sparse-keyed placeholders without inherited prompt text | Existing SDK `addSlide` and `slides add INPUT --layout NAME_OR_PART --output PATH` use the same insertion implementation                 |

J01/J02/J03/J06/J09/J10 apply. Layout insertion requires an actual `SlideLayout`
from the same package. A foreign layout fails with `ValueError` (`invalid-value`);
null or another input type fails with the neutral `TypeError` (`invalid-type`).
Fallback lookup values are explicitly typed as `SlideLayout | null`, as recorded
in the reconciled JS register; arbitrary language objects are not a supported
fallback type. Layout numeric bounds fail with `IndexError`; no Python object
identity or arbitrary method-call route is inferred.

Model label null-removal uses the existing `editContent` validation and parser,
with explicit absence afterward. The CLI empty-string label represents the same
empty visible name, though it need not remove the XML attribute. This specific
language-level absence difference does not introduce ambient I/O. Factory/save
and image admission remain always async; insertion and in-memory collections
remain synchronous. All inputs/parts are explicit admitted capability data.

## Original execution evidence

`packages/pptx/src/slide-layout-model.test.ts` has seven original fast cases:

1. Default Blank layout, synchronous append twice, stable collection/old handles,
   live table content, owner identity and save/reopen.
2. Foreign/null layouts and invalid numeric positions reject without graph changes.
3. Direct SDK-backed `slides add` produces the same part names and payloads as the
   model insertion through an injected memfs command capability.
4. Original Blank/Zebra/Alpha registration order, typed fallback/index lookup,
   null label removal, sparse title/body keys 0/7, omitted latent date key 11,
   prompt-free placeholders and live text save/reopen.
5. Pending first-slide chart workbook, later slide append, chart creation on the
   new slide, retained first chart handle and both series after serialization.
6. Missing first-master access produces `index-out-of-range`.
7. Async image insertion into a newly appended slide retains existing owner
   handles and survives save/reopen.

Initial three tests failed concretely because `slide_layouts` was absent. A later
label mutation case exposed the bounded XML-view restriction for layout XML;
the fix routed model label changes through the existing domain content helper.
No existing regression test was weakened or removed.

Focused final result: 7 tests passed, 395 ms test time, 1.29 seconds total.
`slides.test.ts` and `selectors.test.ts` passed 68 existing tests after extraction.
The layout/presentation/collection-index/command-slide grouping passed 63 tests
before the final image case was added. Test TypeScript compilation and scoped
ESLint passed. The coordinating owner runs maintained full package checks/build
and integration checks before the atomic local commit.

## Remaining public obligations

The layout/master/notes graph remains incomplete. In particular, this work does
not implement `slide_master`, `slide_masters`, `notes_master`, `Slide.slide_layout`,
`Slide.notes_slide`, `Slide.has_notes_slide`, `SlideLayouts.remove`, layout
background/shapes/placeholders/master/used-by-slides views, or inherited equality
and owner collection surfaces. Their denominator rows remain public obligations,
including underscore-prefixed and previously untested members. Only the exact
members and cases above have current evidence; original guide coverage remains a
separate register. No push, release or whole-public-API claim is made here.

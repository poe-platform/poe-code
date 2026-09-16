# PPTX public API target map

Status: Proposed API design and research. No product implementation or original
product test has been executed by this task.

The [JSON map](public-api-map.json) retains all 2,407 IDs from the reconciled
[source inventory](upstream-api-inventory.json), plus 17 explicit bounded-view
members needed to define the XML/package security mapping. Its 2,424 rows are
accounting across types, constructors, properties, methods, enum values, aliases
and protocols, not a percentage of implemented functionality.

The authoritative contracts are [PPTX](../specs/pptx.md), the
[shared SDK](../specs/office-sdk.md) and [shared CLI](../specs/office-cli.md).
The pinned reference revision remains
`278b47b1dedd5b46ee84c286e77cdfb0bf4594be`. The existing published-page review
records a documentation version label of 1.0.0 versus source 1.0.2. This task uses
that recorded evidence; it did not make new network requests or claim a fresh
published-site comparison.

## Reading the register

- `source` records exact declaration/accessor syntax, declaring owner, source
  span/hash and documentation location. Inherited rows retain their concrete
  receiver and their separate declaring owner. `evidence` contains pinned source
  prose, including source descriptions that target drift decisions supersede.
- `target` contains the proposed TypeScript signature, positional/default
  arguments, separate getter/setter types, return and ownership. These are
  declaration fragments, not executable implementations or verified package
  exports. A type row and its constructor-evidence row may describe the same
  constructor; they are distinct source records, not two exports.
- `disposition` distinguishes planned, language-mapped, security-mapped and
  documentation-error decisions. Every row remains `not_implemented`.
  `security-mapped` is an obligation, never a waiver of public behavior.
- `errors`, `side_effects`, `collection`, `mappings` and `documentation_drift`
  qualify the signature. An empty source `direct_raises` list is not a promise
  that delegated validation or publication cannot fail.
- `cli` gives direct routes or closed, versioned typed batch operations. Each
  literal operation selects one known behavior and a typed receiver; the operation
  string is never evaluated as a JavaScript method/property expression.
- `original_tests` gives neutral per-row acceptance IDs/assertions and concrete
  shared scenario profiles. These are proposed original tests, with empty
  implementation-file lists and `executed: false`, as required by the
  documentation-only scope. They are not passing tests or copied source tests.
- `upstream_test_groups` contains class/workflow research leads into the existing
  2,700 unit variants and 973 expanded BDD examples. A candidate link is not a
  reviewed member-level equivalence. Empty candidate groups do not exclude APIs
  from original acceptance. Neither existing test inventory was rewritten.

The map is deliberately explicit about unimplemented evidence. Full public API
coverage remains the implementation target, including inherited members,
underscore-prefixed returned interfaces, helpers, enum aliases and behavior
without reference tests. No unsupported public behavior is classified as private
merely because its type name starts with an underscore.

## Language and security decisions

`language_mappings` elaborates J01–J10 from the
[language reconciliation](api-language-mappings.md). `supporting_types` defines
the additional capability, handle, value and bounded-view types used in signatures.

Neutral model spellings remain primary: `add_slide`, `text_frame`,
`core_properties`, `crop_left`, `from_string`, and similar names are retained.
There is no blanket camelCase alias layer. Operation JSON uses camelCase and CLI
flags use kebab-case. Only the reserved positional parameter `default` becomes
`default_value` in a TypeScript parameter binding; its source identity and legal
JSON option key remain recorded. The two distinct category object families keep
their existing neutral `chart.category` and `chart.data` qualification.

`Presentation` is an async callable factory. Units, RGB and chart-data builders
are synchronous value constructors using `new`. Graph types are obtained through
owners, not arbitrary raw-XML constructors. Constructor evidence is retained with
an explicit owner-acquisition destination. `OfficeError` replaces the branded
source base exception; neutral source exception names remain available.

Admission and publication are always async, even for bytes: `save`, `add_picture`,
`insert_picture`, `add_movie` and `add_ole_object` return Promises. Model-only
operations, chart/workbook generation and fitting with admitted metrics are
synchronous. Byte inputs are snapshotted on admission and byte results are copies.
Paths require an explicit rooted capability. No implicit network, native runtime,
host filesystem, font, identity or clock access is admitted.

Property reads and writes are separate contracts. Creating notes/title/text-frame,
background and line/font-color getters remain observable mutations. Read-only
inspection uses noncreating queries. Placeholder replacement returns the new live
picture/frame and invalidates the previous handle. Cross-owner assignment fails
unless an explicit import remaps ownership. Whole-text assignment and `clear()`
retain their destructive scopes; `_Paragraph.clear()` also returns that paragraph.
They are distinct from formatting-preserving `text replace`.

SDK sequences are zero-based. Checked numeric access rejects invalid positions;
`.at()` permits negative positions only for the corresponding source collection.
Slide placeholders use sparse `idx` keys; table rows/columns/cells and chart points
reject negative positions. Supported slicing has an explicit `step` argument:
end-exclusive bounds, direction-dependent omitted bounds, negative-bound
normalization, clamping and nonzero integer step. Unsupported collection slices
are not silently synthesized. Iteration, containment, reverse traversal, count
and index use the declared collection semantics. RGB remains an immutable
three-channel value, not an unrestricted array or Python tuple implementation.

Lengths store safe integer EMUs. Shared conversion rounds once to nearest integer,
halfway away from zero, unlike source constructor truncation and freeform
ties-to-even. `centipoints` uses floor division by 127, including negatives.
Dates are UTC copies; core dates serialize whole seconds, while chart category
serials use the UTC calendar date and explicit 1900/1904 epoch. Null, false, zero
and empty string remain distinct. Invalid types never gain acceptance through
implicit coercion. Image SHA-1 remains compatibility metadata; fingerprints use
SHA-256.

XML and part access use the 17 explicit bounded-view members. `LineView` and
`PathView` specialize the XML view to validated owned line/path nodes. Views
retain namespace-qualified names, ordered child access, safe owned mutation,
part metadata/bytes and relationship inspection. They do not expose lxml,
arbitrary XPath, loader callbacks, host objects or executable expressions.

## Additional drift found while assigning types

D01–D15 remain as recorded in [the reconciliation](api-reconciliation.md): in
particular, corrected chart/movie returns, `PERCENT_40`, `SLIDE_IMAGE`, invalid
`close`/cell-coordinate recipes, and the promised but source-absent background
setter all remain visible. The map adds these source-validated findings:

| Decision | Pinned evidence                                                                                                                                                                                             | Target resolution                                                                                                                                                                           |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D16      | `src/pptx/dml/color.py:48–95,159–174,195–208`: public RGB prose says absence returns null, but delegated RGB access raises on absent/non-sRGB colors; theme-color prose also overstates when access raises. | `rgb` returns `RGBColor` or `PropertyAccessError`. `theme_color` raises for absent color, but returns `NOT_THEME_COLOR` for an existing non-scheme color. Assignment can change color kind. |
| D17      | `src/pptx/shapes/shapetree.py:742–772`: notes placeholders inherit a getter whose default annotation names a master placeholder, but their factory returns notes placeholders.                              | A successful notes lookup returns `NotesSlidePlaceholder`; a missing lookup returns its explicit `MasterPlaceholder` fallback or null unchanged.                                            |
| D18      | `src/pptx/dml/fill.py:159–161,290–293`: the fill type annotation is nonnullable, but the absent-fill implementation returns null.                                                                           | `FillFormat.type` is `MSO_FILL_TYPE \| null`; absence is an original acceptance case.                                                                                                       |

These decisions correct the target map without editing the earlier research
inventory or conflating its missing annotations with a return of null/void.
Source spans that include both accessor bodies retain both; separate setter
evidence is included where available. Delegated source error behavior remains
subject to the neutral shared error mapping.

## Shared commands and discovery

Common routes use plural `images`, `tables` and `properties`. `text replace`
requires `find`, `with` and exactly one match cardinality. Images retain explicit
occurrence/shared-resource selection and width/height/fit semantics. Ordinary
single edits have direct flags; advanced model behavior has typed batch routes
with owner-bound handles and closed argument schemas.

The register carries the shared version-1 result envelope, selectors, scope,
publication, schema/capabilities and error/exit contracts. Ordinary statuses are
0/1/2/3/4/130; diff uses 0 equal, 1 different, 2 trouble and 130 cancelled.
A successful difference is data, not an SDK exception. `schema` must expose every
declared operation and value type. `capabilities` must report actual
edit/read/preserve/reject subsets and must not turn planned rows into implemented
support. Generated executable JSON schemas and packed-export verification remain
implementation work; the JSON here specifies their required API destinations.

## Evidence and lifecycle

The map retains the exact SHA-256 hashes of its four input audit/inventory files.
All 101 pinned source files and 54 documentation files were hash-checked through
explicit local research paths. No reference runtime or renderer was executed.
Pinned source prose retained in this research map is covered by the
[standalone MIT notice](public-api-map-notice.txt); source-project names remain
research/legal material only.

No publisher document, cloned binary or fixture was changed, adopted as a unit
fixture or cleaned up. Meaningful future QA cases must first become small,
independent original in-memory tests. The agent procedure and check results belong
in [docs/plans](../plans/pptx-public-api-map.md), not a committed QA runner script.

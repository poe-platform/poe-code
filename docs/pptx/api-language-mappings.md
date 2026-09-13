# PPTX API language and security reconciliation

Status: Proposed research decisions; no SDK implementation or passing product tests.

Authority: [shared SDK](../specs/office-sdk.md), [shared CLI](../specs/office-cli.md)
and [format contract](../specs/pptx.md). J01–J10 are referenced by individual
[inventory records](upstream-api-inventory.json). Source signatures are evidence,
not declarations to copy verbatim into TypeScript. The completed
[target API design](public-api-map.json) elaborates these mappings, and the later
[command register](command-coverage.json) records route/schema corrections.
Both remain proposed documentation; compiled exports, executable schemas and
passing original tests are still required. An unannotated source return is not
permission to publish `any`.

## J01 — Names, arguments and construction

Retain neutral model spellings and positional order, including `add_slide`,
`text_frame`, `crop_left`, `from_string` and `number_format`. Python positional
parameters with defaults remain positional optional parameters. Only keyword-only
parameters become a trailing typed options object, retaining their source names.
`undefined` selects a default; `null` means explicit absence where allowed.
Python examples using named positional arguments translate to positional calls;
there is no inferred keyword-object overload. Operation JSON is independently
camelCase, as required by the shared contract.

The reserved positional parameter `default` binds as `default_value` in
TypeScript. Its source identity stays in research; `default` remains a legal JSON
object key. This is a specific language mapping, not a general rename policy.

`Presentation(input?: BinaryInput | null, context?: OfficeContext)` always returns
`Promise<Presentation>`. `CategoryChartData(number_format = "General")`,
`XyChartData(number_format = "General")`, `BubbleChartData(number_format = "General")`
and the documented `ChartData` compatibility subclass are synchronous builders.
Unit and RGB constructors are synchronous value constructors. Preserve the source
constructor signatures in research even for returned interfaces, but do not
publish arbitrary raw-XML constructors: the presentation guide explicitly says
that graph objects are obtained through their owners. `Slide`, `_Cell`, `_Run`,
`_GradientStop`, `_OleFormat` and similar names describe supported returned
interfaces; their leading underscore does not make them private.

## J02 — Properties and ownership

A source property maps to direct JS property access. A setter maps to assignment;
read-only and lazy properties reject assignment. Lazy properties are not methods.
The register separates source `read_signature` and `write_signature`, including
nullable returns and asymmetric setters where annotated. Absence of a source
annotation is recorded as such; it is not a return of `null`.

Returned graph objects are live and owned. Cross-presentation assignment fails
unless an explicit import operation remaps the graph. An array returned for a
source tuple is a readonly snapshot of membership containing live object handles;
it is not a deep clone. This applies to paragraphs, runs and `used_by_slides`.
Replacement of a rich placeholder invalidates the previous handle deterministically
and returns the new picture or graphic frame, under the original placeholder key.
An invalidated handle raises `InvalidHandleError`, not an incidental JS null error.

Accessor creation is preserved, including notes, chart/axis titles, text frames,
background fill definitions and line color conversion to solid fill. The absence
of an explicit setter does not imply a nonmutating getter. CLI reads use
noncreating queries; they must not call these creating getters. Cached proxy
allocation alone is distinct from changing package XML.

## J03 — Collections, protocols and scalar-like objects

The inventory's `collection_protocols` describes each of 33 source collections.
Expose `.length`, `[Symbol.iterator]()` and checked zero-based numeric lookup.
Failed bounds access raises `IndexError`; it never returns an unrelated element.
`at(index)` supports a negative index only where the source does. Table rows,
columns, cells and chart points reject negative positions. Sequence slicing is
supported for chart-data collections, chart plots and freeform operations; the
source wrappers for slides, shapes, series, categories, gradient stops and
adjustments do not correctly construct a sliced collection, so no blanket slice
promise is made. The target register explicitly defines
`.slice(start?, end?, step?)` for supported collections and the immutable RGB
value. It returns a readonly membership snapshot. Omitted bounds depend on step
direction, the end is exclusive, negative bounds normalize against length, and
bounds clamp to the valid interval. Step must be a nonzero integer; zero raises
`ValueError`. The ordinary two-argument form remains available under the shared
SDK contract. Other collections do not acquire slicing through this mapping.

`SlidePlaceholders[idx]` is sparse key lookup and missing keys raise `KeyError`.
Iteration uses ascending placeholder `idx`; negative keys are not from-end
positions. Layout/master/notes placeholder collections instead use positional
indexing and their documented `.get(...)` lookup semantics. Adjustment collection
items are numbers, not `Adjustment` objects, despite the introductory prose.
Indexed assignment changes the effective adjustment and XML; it is not an array
of detached values.

For notes placeholders, `get(ph_type, default_value?)` returns a
`NotesSlidePlaceholder` on a match and the supplied `MasterPlaceholder` fallback
or null on a miss. This retains the corrected factory return and the explicit
fallback type from D17; it does not reinterpret the fallback as a notes object.

Inherited sequence operations remain accounted for: containment maps to
`includes(value)`, reverse iteration to `reversed()`, and documented `count`/`index`
retain their names. Type-specific overrides take precedence over ABC defaults.
Iterable protocols implied by integer lookup are included even without a local
`__iter__`. Model comparison uses explicit `equals(other)` for source value or
underlying-element equality; JS reference identity is not Python proxy equality.
RGB uses a readonly three-channel value and `toString()` as six uppercase hex
digits. Chart category labels use `.label`/`toString()`; they are not JS String
subclasses with a copied Python string-method library. Freeform operation items
are bounded drawing-operation views, including move, line and close records;
`apply_operation_to` can target only an owned validated path view.

## J04 — Enums and aliases

Retain all documented symbols, numeric/string values and 13 documented enum
aliases as references to the same enum definition. Individual symbol records
also retain equal-valued language aliases (`KIRGHIZ`/`KYRGYZ`,
`SESOTHO`/`SUTU`) and the source's `OTHER`/`SOUND` collision. The last is a recorded
source quirk, not evidence of a distinct numeric audio value. D06 corrects the
source spelling `ERCENT_40` to documented `PERCENT_40`, value 6 / XML `pct40`.
No typo alias is promised.

Expose typed `.name`/`.value` metadata and immutable `.xml_value` where applicable.
The source permits reassignment of its `xml_value` instance attribute; the target
rejects such reassignment to keep enum/XML conversion definitions stable. The
register records source writability separately from target immutability; `PROG_ID` also supplies `progId`, dimensions
and a neutral authored icon identifier. `from_xml(xml_value: string): Enum`,
`to_xml(value: Enum): string` and `validate(value: Enum): void` are explicit
bounded conversion/validation helpers where the source enum supports them.
Unsupported XML conversion (including return-only sentinels) fails with a typed
value error. Python metaclass construction of new enum types is not a document
API. Enum type/value availability does not promise every enum-valued chart can
be created: chart creation support is a separate capability.

## J05 — Numbers, lengths, dates, colors and absence

Lengths are value objects storing safe integer EMUs. Conversion factors are
914400/inch, 360000/cm, 36000/mm, 12700/point and 127/centipoint. Retain `Length`,
`Inches`, `Cm`, `Mm`, `Pt`, `Emu`, `Centipoints` and their documented accessors.
There is no documented PPTX `Twips` constructor. Conversion uses the shared
nearest-integer, halfway-away-from-zero rule once, with finite/safe checks before
and after. This deliberately differs from source unit constructors' truncation
and freeform coordinate rounding's ties-to-even. Integer EMU inputs stay exact.
The `centipoints` accessor uses floor division by 127, including negative values.
Do not substitute JS bitwise coercion or silently lose integer precision.

RGB channels must be integers in [0,255]; `from_string` accepts exactly six hex
digits. The source slices the first six characters without enforcing total length;
rejecting trailing characters is an explicit target validation difference, not
a source validation claim. The value is immutable. Formatting preserves `true`, `false`, `null` as
three distinct states; zero and empty string are not interchangeable with null.
Existing negative or greater-than-one crop metadata is retained and readable;
new edits still satisfy the format's visible-extent and finite-limit checks.

D16 and D18 qualify color/fill absence in the target register: reading `rgb`
without an sRGB color raises `PropertyAccessError`; reading `theme_color` without
any color raises, while an existing non-scheme color returns `NOT_THEME_COLOR`.
`FillFormat.type` is `MSO_FILL_TYPE | null`, with null for absent fill. These
corrected returns/errors govern original cases instead of the conflicting source
prose or nonnullable annotation.

Core property strings retain the documented 255-Unicode-code-point bound and empty-string
absence. Dates are UTC `Date` values or `null` on absent reads. Serialize whole
UTC seconds, dropping subsecond precision explicitly; reject invalid dates and
inputs requiring timezone guessing. Date setters take valid dates, not implicit
host time. Revision remains explicitly controlled; saving does not increment it.

## J06 — Always-async admission and publication

`BinaryInput = Uint8Array | ByteSource | VfsPath` and
`BinaryOutput = ByteSink | VfsPath` are conceptual capability types, not Node
streams or unrestricted host paths. Strings in source path positions require the
explicit context VFS; missing authority fails. Bytes and streams obey the same
limits and cancellation rules. Public byte results use owned `Uint8Array` copies
so caller mutation cannot alter the package behind validation.

`save`, `add_picture`, `insert_picture`, `add_movie` and `add_ole_object` always
return Promises, including byte-only inputs. `add_chart`, `insert_chart`, table
insertion, chart-data replacement and other in-memory methods remain synchronous;
producing an embedded workbook does not imply host I/O. Movie insertion returns
`Promise<Movie>`, picture insertion returns `Promise<PlaceholderPicture>`, and OLE
insertion returns `Promise<GraphicFrame>`. Preserve positional width/height and
poster/icon defaults; admit all supplied inputs before a mutation becomes visible.
No automatic movie frame extraction, external-link fetch or embedded-object
activation is allowed. Missing poster/icon defaults use original authored assets.

Image bytes, content type, extension, filename, DPI, pixel size and SHA-1 metadata
remain available. Source SHA-1 is compatibility metadata, never the package or
fixture integrity key. Missing/invalid image DPI falls back to 72 per axis under
the source characterization rules. Unsupported image characterization needs a
bounded supplied capability or an explicit unsupported result; it cannot silently
count as full image API coverage.

## J07 — Explicit metrics, time and neutral defaults

`fit_text(font_family = "Calibri", max_size = 18, bold = false, italic = false,
font_file: FontMetricsHandle | null = null): void` uses already-admitted metrics
from context or the explicit handle. The security mapping of `font_file` is a
metrics handle, never a host font path. Missing matching metrics fails visibly;
no filesystem font search or native font library runs. Any separate font-byte
admission is async before this synchronous model method. Metadata autofit does
not claim identical rendering.

No-argument creation and creating getters use original default parts/assets.
Any timestamp needed by default core properties comes from context; if none is
supplied, that timestamp is omitted, never replaced with the wall clock. Default
author/project strings are original neutral values. Hyperlink/action targets are
stored metadata: even macro/run-program actions are never executed by the SDK.

## J08 — Errors

The target register defines these exact neutral error mappings:

| Condition                          | Target class           | Stable code            |
| ---------------------------------- | ---------------------- | ---------------------- |
| Invalid value                      | `ValueError`           | `invalid-value`        |
| Invalid type                       | `TypeError`            | `invalid-type`         |
| Invalid sequence position          | `IndexError`           | `index-out-of-range`   |
| Missing required key               | `KeyError`             | `missing-key`          |
| Unavailable property               | `PropertyAccessError`  | `property-unavailable` |
| Assignment to a read-only property | `PropertyAccessError`  | `read-only-property`   |
| Invalidated model handle           | `InvalidHandleError`   | `invalid-handle`       |
| Unsupported edit                   | `OfficeError`          | `unsupported-edit`     |
| Missing input package              | `PackageNotFoundError` | `io-failure`           |
| Invalid XML                        | `InvalidXmlError`      | `invalid-xml`          |

Missing optional lookups retain their documented default/null behavior. A valid
handle with an unavailable property is distinct from an invalidated handle.
The source-branded base exception is not exported. Public errors must not leak
internal class names or host paths. These are proposed error contracts, not a
claim that target exception classes have been implemented.

The CLI maps validation/unsupported/stale/selection failures to 1, usage/schema
errors to 2, I/O/publication failures to 3, limits to 4 and cancellation to 130.
Success is 0. Diff uses 0 equal, 1 different, 2 trouble, 130 cancelled; a difference
is successful data, not an SDK exception. Source `direct_raises` lists only explicit
raises in that declaration, not a complete transitive exception proof.

## J09 — Bounded XML and package views

Public `element`/`part` access remains visible and security-mapped. The target
exposes namespace-qualified name, attributes, text, ordered child inspection,
owned node insertion/removal/replacement, and package part URI/content type,
bounded bytes and relationship inspection. Mutations run through owner-aware
operations with namespace/MCE, relationship, resource-limit and publication
validation. `parent` exposes an owned model/view parent, not a host object.

Do not mirror unrestricted lxml methods, arbitrary XPath, Python descriptor
internals, filesystem access or package-loader callbacks. `ln`, `get_or_add_ln`
and freeform `apply_operation_to`, where encountered through public views, are
bounded line/path operations with creating side effects recorded. The target API
map now enumerates 17 additional view members and their original acceptance
obligations. Those declarations still need implementation and passing tests;
`security-mapped` is a design disposition, not a coverage waiver. RST exclusions
alone cannot hide returned public behavior.

## J10 — Model edits and shared commands

Whole-object `.text = value` and `clear()` preserve their documented destructive
scope and required empty paragraph. They route to explicit resource setters
such as `shapes set --text` or validated typed paragraph/run operations. They are
not the formatting-preserving `text replace` operation.

Direct common paths are `images list/add/replace/extract`, `tables ...`,
`properties list/get/set/remove`, `text`/`text get`, and `text replace` with
`--find`, `--with` and exactly one of `--first`, `--all`, `--occurrence`.
CLI selectors are one-based and owner-scoped; stale opaque tokens and ambiguous
labels fail. No implicit master/notes/shared-resource edits. Outputs require
`--output` or `--in-place` except dry-run; force never bypasses validation.

Every model behavior must have a direct operation or an explicitly typed batch
operation. Do not add a generic method-name/property-name evaluator. `schema`
and `capabilities` must expose actual schemas and edit/read/preserve/reject
subsets. JSON uses the common version-1 envelope and dotted operation IDs, with
camelCase options, deterministic ordering and bounded diagnostics. These are
acceptance obligations; no command or schema is implemented by this research.

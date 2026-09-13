# Paired Office QA contract review

Status: Documentation evidence only; all product recipes remain proposed/unrun.

The [paired agent QA plan](../plans/office-cli-qa.md) applies the shared
[CLI](../specs/office-cli.md) and [SDK](../specs/office-sdk.md) contracts. No scoped
`AGENTS.md` was found beneath `docs`. No product files, README, downloaded inputs
or cloned binaries were changed. No reference/native runtime or network was used.

## Evidence reviewed

The complete API/test inventory JSON was parsed, including all records and
parameter/example variants. Existing counts remain 2,407 reconciled API records,
2,700 unit variants and 973 expanded BDD examples. The target map has 2,424 rows,
including 17 additive bounded-view members. These mixed counts do not establish
implemented coverage. The historical test audit reports reference passes only.

| Input                                          | SHA-256 at review                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| [API audit](upstream-api-audit.md)             | `293232ccf5697ea2adcca5bfda894ffe104c6799dadc7d73be109e5019e99d2f` |
| [API inventory](upstream-api-inventory.json)   | `cd6467079c8f93d5be57758646f3fcd3667a6a13a1782fb371320c378803b934` |
| [Test audit](upstream-test-audit.md)           | `63a4ba0c9845b2d4e833288d5e7fd459684be1c25cea1712727c1e9afe32528b` |
| [Test inventory](upstream-test-inventory.json) | `702a7b6aaa2009050583c4ef4c2b363ef5f52bea4a59cc60aa5861e30731fa6d` |

The [target API map](public-api-map.json), [command register](command-coverage.json)
and [command reconciliation](command-coverage-notes.md) refine earlier research.
No fresh published-site comparison, source re-audit or reference suite execution
is claimed here. Published-version drift remains the pinned audit's observation,
not a claim about today's site.

## Exact mapping decisions used by QA

These are proposed target decisions from `public-api-map.json/language_mappings`,
read with [J01–J10](api-language-mappings.md). None is an implementation waiver.

| Mapping             | Exact target behavior and acceptance consequence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| J01 names/arguments | Neutral snake_case model names stay primary. Positional order/defaults remain; keyword-only fields become trailing typed options retaining source names. Reserved positional `default` binds as `default_value`. Operation options separately use camelCase. `Presentation` is an async callable factory; value/chart-data constructors use `new`.                                                                                                                                                                                                        |
| J02 ownership       | Properties are direct synchronous access. Returned model handles are live and owner-bound; membership snapshots are readonly but contain live handles. Byte and Date results are copies. Rich placeholder insertion returns the replacement and invalidates the old handle. Cross-owner assignment fails without explicit import.                                                                                                                                                                                                                         |
| J03 collections     | Checked zero-based SDK numeric lookup; one-based CLI ordinals. Numeric negative sequence lookup fails; `.at` permits negatives only in its collection profile. Placeholder `idx` is a sparse key, never a position. Supported `.slice(start?, end?, step?)` uses end-exclusive bounds, directional omitted bounds, normalized negatives, clamped bounds and nonzero integer step; zero step raises `ValueError`. Other collections do not acquire slicing. Iteration uses `Symbol.iterator`; equality uses explicit `equals`, not overridden JS identity. |
| J04 enums/helpers   | All documented symbols and aliases remain addressable with immutable typed metadata; `xml_value` is immutable. `PERCENT_40` is value 6/XML `pct40`, without a typo alias. `OTHER` and `SOUND` retain value 1. Enum conversion rejects invalid values and return-only sentinels without XML mappings. Enum availability is distinct from chart creation support.                                                                                                                                                                                           |
| J05 values          | Safe finite integer EMUs, with 914400/in, 360000/cm, 36000/mm, 12700/pt, 127/centipoint. Geometry converts once, nearest with ties away from zero; centipoints accessor floors division by 127. RGB requires integer channels 0..255 and exactly six hex digits on parsing. `undefined` chooses an optional default; null is admitted only by nullable types, distinct from false/zero/empty string. Core strings allow 255 Unicode code points. Valid UTC dates serialize whole seconds; no guessed timezone or automatic revision increment.            |
| J05 chart dates     | UTC calendar date, ignoring time-of-day; 1900 serial epoch 1899-12-31 with +1 after day 59, or 1904-01-01 without that adjustment. Date `numeric_str_val` has one decimal place. This is distinct from core-property UTC timestamp serialization.                                                                                                                                                                                                                                                                                                         |
| J06 I/O             | `Presentation`, `save`, `add_picture`, `insert_picture`, `add_movie`, `add_ole_object` always return Promises, even for bytes. Model-only chart/table edits and admitted-metrics fitting stay synchronous. Inputs are `Uint8Array`, explicit byte sources or scoped VFS paths; snapshot bytes on admission. No implicit external fetch, decoder process or embedded activation.                                                                                                                                                                           |
| J06 images          | Missing/invalid DPI falls back to 72 per axis; finite DPI characterization rounds ties to even, then rejects values outside 1..2048 to fallback. Geometry separately rounds ties away. No dimensions uses native pixel/DPI size; one dimension preserves aspect; both give explicit size; placeholder insertion cover-crops. SHA-1 remains image compatibility metadata; integrity uses SHA-256.                                                                                                                                                          |
| J07 authority       | `font_file` becomes an already-admitted `FontMetricsHandle`; missing metrics fails visibly. Context supplies time/author/fonts/VFS/limits/cancellation; omitted creation time stays absent. Original defaults, posters/icons and inert action metadata; no host discovery or execution.                                                                                                                                                                                                                                                                   |
| J08 errors          | `ValueError/invalid-value`, `TypeError/invalid-type`, `IndexError/index-out-of-range`, `KeyError/missing-key`, `PropertyAccessError/property-unavailable`, and `OfficeError/unsupported-edit` are explicit mappings. Invalidated handles use `InvalidHandleError/invalid-handle`; read-only assignment uses `PropertyAccessError/read-only-property`; input/XML failures use `PackageNotFoundError/io-failure` and `InvalidXmlError/invalid-xml`. Shared validation/limits/publication failures remain possible beyond directly declared raises.          |
| J09 XML/package     | Public `element`/`part` map to bounded owner-aware XML/package/line/path views, with validated namespace/MCE, relationships and publication. No unrestricted dependency API, XPath/eval, loader callback, host object or external resolution. Leading underscores never remove public behavior from coverage.                                                                                                                                                                                                                                             |
| J10 mutation/CLI    | Whole-text setters/clear retain documented destructive scope; preserving literal replacement is `text replace`. Reads use noncreating queries. Plural resources, shared JSON/statuses and explicit scope apply equally. Advanced behaviors use enumerated typed batch operations and handles, not evaluated member strings.                                                                                                                                                                                                                               |

## Documentation drift resolution for these recipes

The earlier API inventory and language notes intentionally record a prior research
stage. Their statement that concrete signatures are the "next" task is historical:
the later map now proposes signatures and the command register proposes schemas.
Neither proves exports, runtime schemas, executed tests or released commands.
The QA plan therefore points at these later proposals while keeping implementation
and packed-consumer verification outstanding.

| Evidence disagreement                                                  | Resolution used here                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Earlier two-argument slicing discussion versus later step-aware target | Use J03's explicit three-argument supported slice contract; never infer slices for every collection.                                                                                                                                                  |
| API factory `create` route versus direct CLI creation                  | Direct `create` uses output/template flags. The typed model factory uses `presentations.open`; no overload conflating context/input with direct creation.                                                                                             |
| Earlier invented freeform `.close` route and cell coordinate members   | Follow C02–C04: `addLineSegments` with `close: true`; obtain logical coordinates through `tables get`. No fictitious `close`, `row_idx` or `col_idx` method is added.                                                                                 |
| Schema `commandPath` versus declared discovery fields                  | Direct `schema text replace` uses positional path; typed discovery uses `path`, with declared type/member fields where applicable.                                                                                                                    |
| Earlier generic batch prose omits common per-item options              | The closed command `BatchItem` schema separates `arguments` and applicable `options`, with typed `receiver` where required. Q18 uses only shared property arguments, avoiding a made-up option layout. No kebab-case JSON keys or arbitrary dispatch. |
| Earlier incorrect annotation/enum expectations                         | Retain GraphicFrame/Movie returns, D07's visible proposed background setter, `PERCENT_40` XML `pct40`, `SLIDE_IMAGE`, and D16–D18 color/fill/notes-placeholder corrections. No source error becomes a target promise or private exclusion.            |
| Similar template commands suggest identical payloads                   | The common file/inline data source flags match; binding semantics remain format-specific. The exact PPTX payload comes from `$defs.Bindings`. DOCX setup must use its declared schema rather than assuming the PPTX array.                            |

The QA plan covers common workflows and dangerous boundaries, not all public API
behavior by itself. Every inherited member, enum/alias, collection protocol,
helper, returned interface and documented API lacking source tests still needs
original acceptance evidence. Unsupported public APIs remain visible and prevent
whole-API coverage claims. Prior D01–D18/C01–C04 findings are preserved rather
than rewriting pinned evidence or unrelated work.

## Validation boundary

Maintained scoped formatting, local-link checks, input hash/count checks and
validation of literal JSON examples are documentation checks only. Their actual
results belong in the paired plan. No CLI/SDK recipe, renderer, screenshot or
product unit test ran. Publisher downloads and clone binaries remain untouched;
meaningful future QA cases require original small unit reductions before cleanup.

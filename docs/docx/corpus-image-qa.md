# Corpus image qualification

Executed 2026-09-15 against the current working-tree SDK. Scope and source
identities are in [the executed plan](../plans/docx-corpus-image-qa.md); exact
observations and hashes are in [the receipt](corpus-image-qa.json).
This is a bounded QA result, not whole-format or public-model conformance.

Four independently authenticated documents contain **280 stored media parts**:
71, 124, 43 and 42. The illustrated report contains four SVG, 24 EMF and one WDP
resource. The other illustrated report contains one SVG. Native drawing counts
and logical selections differ: current inventories expose 72, 70, 92 and 42
logical images, while extraction publishes 72, 70, 146 and 43 resources because
an occurrence can include alternates. All **331 extracted payload hashes** and
four extraction manifests match independent SHA-256 checks. Extraction covers
selected logical occurrences, not every dormant/orphaned stored media part.

The first, third and fourth inventories exceed the default work budget; explicit
host 8 GiB work profiles succeed. The illustrated report's insertion additionally
requires an explicit ten-million XML-node profile. These are cumulative parser
budgets, not measured RSS, input-size guarantees or default-profile passes.

Two original baselines fail partial `core-v1` validation: the first has 14 style
next-type/table-grid diagnostics, and the fourth has ten style next-type
diagnostics. Their attempted image edits refuse before publication. The other
two baselines validate under the stated profile. That validator is not full XSD
validation and does not prove rendering fidelity.

Inline insertion succeeds on the second and third originals with exact authored
PNG bytes, 914400 × 457200 EMUs and original alt text. All 124 and 43 original
media parts remain byte-exact, including unsupported graphics and native SVG
alternates. An anchored EMF crop/rotation edit on the third original succeeds,
changes only document XML and preserves every original media/relationship part.
An attempted grouped/extension-sensitive anchor edit on the second original
refuses faithful-preservation admission; it is not a successful layout edit.

Actual shared raster carriers in the illustrated report have opaque DPI
extensions and refuse replacement. A separately labeled disposable derivative
removes only five blip-local DPI extension lists for one shared raster; no media
changes. It then qualifies one-reference and five-reference replacement through
the public SDK. Independent checks retain dimensions, alt text, unselected
resources and unrelated package members. This derivative does **not** qualify
replacement of the original extension-bearing carriers. EMF and native SVG-pair
replacement attempts refuse before replacement acquisition and write no output.

Representative paginated originals and successful edits were opened as PNGs
from a portable QA-only renderer with IP traffic denied. Source page counts are
27, 27, 167 and 170. Photos, illustrations, existing wrapping and page-boundary
clipping were inspected separately from XML/CRC/hash checks. The second original
already clips a bottom figure on page 2; the third already overlaps cover and
acknowledgment content. Inline insertion visibly reflows text and can overlap
existing positioned cover labels. It is not a pagination-preserving operation.
One/five-reference replacement markers render in the expected recommendation
locations without changing surrounding text flow on inspected pages.

A disposable forced-raster-fallback derivative removes 54 SVG extension lists
from the successful report insertion output, retaining all 44 media resources
and all relationships. Its page 1 still displays the fallback copyright logo;
native and forced-fallback page PNGs are not byte-identical. Visual inspection
establishes visible fallback availability, not identical rasterization or the
renderer preference for every existing native pair. Authored one-page EMF
wrapping outputs show text beside the square with square wrapping and below it
after explicit top/bottom wrapping, with no observed clipping or lost graphic.

The third report's medallion remains visible after rotation alone but disappears
after crop plus rotation in this renderer despite exact EMF preservation. An
original 188-byte EMF containing an outlined square and diagonal remains visible
after the same edit. The report EMF includes bitmap-transfer records, so a second
authored 256-byte EMF embeds an original 2 × 2 bitmap; it also remains visible
after crop/rotation. The observation does not reduce to a generic EMF failure;
its cause remains unresolved. No product fix, pixel-parity guarantee, native Word
check, or complete-page fidelity certification is claimed. The authored EMF
preservation case is retained; the report artwork is not retained in unit tests.

## JavaScript/security and documentation reconciliation

| Surface                                         | Exact mapping and coverage boundary                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Utility images list/get/extract/add/replace/set | Always awaited Promise operations on admitted `Uint8Array` and explicit `ArchiveContext`/publication capabilities. CLI paths use plural `images`; typed operation JSON remains camelCase. These snapshots do not instantiate live owners.                                                                                                                 |
| Binary input/output                             | Closed bytes/base64 or capability-scoped VFS descriptors; no ambient host paths, image decoding, external-link downloads or renderer authority. Extraction supplies a scoped filesystem; document edits use explicit awaited sinks.                                                                                                                       |
| Selection and sharing                           | One-based utility selectors and authenticated immutable Location tokens; default occurrence replacement versus explicit `shared: true` resource intent. Live model sequences remain zero-based.                                                                                                                                                           |
| Measurements                                    | Explicit value/unit Length records; inventory emits integer EMUs. Crop is a dimensionless fraction; omitted properties preserve, false/zero remain explicit. Wrapping changes refuse loss of incompatible stored distance metadata unless explicit distance intent resolves it.                                                                           |
| Standalone Image                                | `from_blob(blob: Uint8Array, context?): Promise<Image>` and `from_file(input: ImageModelInput, context?): Promise<Image>`; admitted properties and `scaled_dimensions(width?, height?): readonly [Length, Length]` remain synchronous. SHA-1 is compatibility metadata; evidence and resource identity use SHA-256. No model aliases are introduced.      |
| Live picture owners                             | `Document.add_picture` and `Run.add_picture` retain neutral spellings and async admission returning `InlineShape`. InlineShape width/height/type, InlineShapes iteration/length/lookup, inherited part, ImagePart/ImageParts and enum aliases remain separately obligated. Utility tests do not qualify them.                                             |
| Collection/helper/protocol coverage             | `.length`, `Symbol.iterator`, zero-based lookup/`.at`, and `.slice` only where supported; unit/color helpers and documented public underscore-prefixed owners remain in scope. Corpus QA does not implement these APIs or APIs without source tests.                                                                                                      |
| Errors and discovery                            | Neutral typed errors retain shared ordinary-command CLI mapping: invalid document/unsupported edit/profile/selection/validation 1, usage/schema 2, I/O/publication 3, resource limits 4, cancellation 130 and success 0. Existing schema/capabilities remain conservative. This task changes neither command grammar nor schema/discovery or CLI visuals. |

The entire historical inventory was parsed: **920 records**, **262 nested enum
values/aliases**, **417 inherited records**, and **12 underscore-prefixed type
records** by the inventory's `python_kind` classification. Historical statuses
remain 410 planned, 378 security-mapped, 124 language-mapped and eight
documentation-error. These categories are research dispositions, not current
implementation totals. No row is promoted or removed by this campaign.

Existing drift decisions remain explicit: D11 includes returned Drawing image
members and the documented bounded `_drawing` view; D12 distinguishes embedded
from linked images and grants no linked acquisition; D13 uses vertical DPI for
native height; D19 distinguishes inline picture construction from additive
floating-layout utility edits. Earlier blanket corpus “not run” statements are
historical acquisition-stage evidence; this receipt supersedes them only for
the stated image cohorts. Neither historical successful extraction nor the
current partial validator implies whole API or visual conformance. Shared text
replacement, tables/properties and JSON/selector/discovery contracts are retained.

## Regression reduction and delivery

Nine original tests compose shared/occurrence replacement with later crop/wrap edits,
verify exact repeated extraction/manifests, preserve authored EMF/WDP/SVG-pair
resources during insertion, and require refusal before unsupported acquisition.
The complete authored EMF record-graph assertion failed before fixture code was
expanded from a signature-only input; it then passed. The bitmap record-graph
variant also failed before its authored fixture expansion and then passed.
The initial absent-fixture
failure and distance-intent preparation correction are recorded separately.
No product code changed, no source artwork/wording/binary fixture was copied,
and no substantial implementation was derived requiring an additional notice.

Final maintained checks pass 169 files / 3367 tests and package ESLint/source/test
types, with zero errors and one existing lint warning. Four selected input files
and 692 exclusively owned output files are deleted with verified absence; all
19 other downloaded inputs and older outputs are preserved. Exact checks and
cleanup hashes are recorded in the receipt and plan.
Only owned files are eligible for an atomic local main
commit. Other corpus files, prior QA outputs and unrelated changes are preserved.
Later tasks remain pending; there is no push or release.

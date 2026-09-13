# Presentation implementation checkpoint

Inspected commit: `a7fbba9c421decb4ba710db2c6c16543eba10c34` on local main.
This is a committed-source review, not a clean-commit runtime test or a release.
The [verification receipt](implementation-checkpoint-20260913.json) records exact
input/source hashes, inventory joins and boundaries. The [procedure](../plans/pptx-implementation-checkpoint-20260913.md)
contains QA and follow-up work. No product code or tests changed.

The [format spec](../specs/pptx.md) now identifies this inspected commit instead of
“Not applicable.” Its status remains Proposed. The [shared CLI](../specs/office-cli.md)
and [shared SDK](../specs/office-sdk.md) govern target behavior; neither all proposed
operations nor whole-public-API coverage is complete.

## F01–F60 support at the inspected commit

Levels describe the bounded implemented surface found in committed source, not
successful independent acceptance of every family. `edit` includes only the stated
mutation subset; `read` does not authorize mutation; `preserve` is opaque retention.
Rejected subfeatures remain explicit even in an edit family. The primary evidence
is the committed command engine's capability/dispatch declarations, public index,
package reader, MCE interpreter, semantic validator and presentation model. These
are hashed in the receipt. The command register's historical proposed levels are
not substituted for observed implementation. Runtime discovery uses named subsets,
not a complete F-ID conformance certificate, and input assessment is `complete: false`.

| ID  | Family                    | Level    | Supported subset and remaining boundary                                                                                                                                            |
| --- | ------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F01 | ZIP                       | edit     | Bounded shared ZIP codec, ZIP64 read, owned bytes and package writing; no encrypted/multi-disk admission promise.                                                                  |
| F02 | OPC                       | edit     | Content types, relationships and bounded graph operations; unknown references can block mutation/import.                                                                           |
| F03 | Dialects/kinds            | edit     | Macro-free Transitional presentation/template/show creation; Strict read/MCE handling exists, but Strict creation and mixed-dialect import reject. No universal Strict edit claim. |
| F04 | XML/MCE                   | edit     | Namespace-aware parsing, compatibility view and bounded XML replacement with explicit validation limits; opaque branches retained, unsupported required namespaces reject.         |
| F05 | Inspection                | read     | Ordered slides, graph, hashes, locations and bounded style provenance; no complete semantic census.                                                                                |
| F06 | Creation                  | edit     | Original blank master/layout and structured text slides; supplied-template creation rejects.                                                                                       |
| F07 | Slide lifecycle           | edit     | Add/move/name/hide/remove/duplicate with supported reference policies; opaque dependencies can reject.                                                                             |
| F08 | Merge/split/import        | edit     | Bounded dependency closure and deterministic remapping; conflicting notes masters, table styles, fonts, mixed dialects and unsupported references reject.                          |
| F09 | Sections/custom shows     | edit     | Names/order and supported membership; sections require contiguous nonoverlapping membership.                                                                                       |
| F10 | Presentation settings     | edit     | Canvas, number start, loop and show mode; restricted explicit scaling. Grid/view/print settings otherwise retained.                                                                |
| F11 | Slide masters             | edit     | Create/rename, supported text/shapes/backgrounds with explicit shared scope; not arbitrary master editing.                                                                         |
| F12 | Layouts/placeholders      | edit     | Create/edit/apply/remove unreferenced layouts, explicit type/index mapping; ambiguity rejects.                                                                                     |
| F13 | Themes/inheritance        | edit     | Existing palette/font slots and overrides, bounded effective text provenance; no complete effective-style resolver.                                                                |
| F14 | Backgrounds               | edit     | Solid/linear RGB gradient/picture and inherited backgrounds; advanced effects retained.                                                                                            |
| F15 | Text reading              | read     | Logical paragraph/run/break/field order and explicit notes/master scopes; no visual order or fine-grained selector completeness.                                                   |
| F16 | Text editing              | edit     | Literal cross-run replacement within paragraphs; fields/breaks stop matches, explicit cardinality, no normalization.                                                               |
| F17 | Text styling              | edit     | Local run formatting and shared font model; unset/inherited values remain distinct. Not full rendering fidelity.                                                                   |
| F18 | Paragraphs/lists          | edit     | Local spacing/alignment/indent/bullets/numbering/RTL/tabs; no layout engine.                                                                                                       |
| F19 | Text frames               | edit     | Insets/columns/wrap/rotation/autofit metadata; fit uses supplied scalar metrics and bounded horizontal single-column text.                                                         |
| F20 | International text        | edit     | Logical Unicode replacement and direction/language metadata; shaping, fallback and visual bidi remain unverified.                                                                  |
| F21 | Fields                    | edit     | Cached field text with explicit caller text/time; no automatic field evaluation.                                                                                                   |
| F22 | Shapes                    | edit     | Text boxes/presets and supported identity/geometry/format metadata; unsupported geometry/effects remain bounded.                                                                   |
| F23 | Custom geometry           | edit     | Integer EMU move/line/quadratic/cubic/close and live builder; bounded commands, no arbitrary formula/winding evaluation.                                                           |
| F24 | Transforms/groups         | edit     | Parent-coordinate geometry and restricted grouping/ungrouping with tolerance; unsafe transformed geometry rejects.                                                                 |
| F25 | Z-order/alignment         | edit     | Explicit sibling order/alignment/distribution/duplication; locked or unsupported referenced objects reject.                                                                        |
| F26 | Connectors                | edit     | Straight/elbow/curved connectors, bounded sites and detach/remove policies; arbitrary routing and rotated coordinate edits unsupported.                                            |
| F27 | Drawing effects           | edit     | Solid/gradient/pattern/picture fills, lines/alpha/simple shadows; advanced stacks, DAGs and 3D retained.                                                                           |
| F28 | Tables                    | edit     | Rectangular grid, text/format/sizes; direct CLI uses row,column and fails shared B2 grammar.                                                                                       |
| F29 | Merged cells              | edit     | Rectangular spans, split, explicit insertion/deletion conflict policies; not arbitrary malformed-span repair.                                                                      |
| F30 | Image inventory           | read     | Occurrences/unique parts, hashes, crop/geometry/alt text, inherited scopes and inert targets.                                                                                      |
| F31 | Image insertion           | edit     | PNG/JPEG/GIF/BMP/TIFF/placeable-WMF byte admission with bounded metadata/sizing; no native decoder.                                                                                |
| F32 | Image replacement         | edit     | Template image bindings provide a bounded replacement path; standalone images replace is absent at this commit. Uncommitted implementation is excluded.                            |
| F33 | Image formatting          | edit     | Contain/cover/stretch, crop/rotation/flips/opacity/solid border/alt text; positive visible area required on crop edits.                                                            |
| F34 | Vector images             | preserve | Retain vector/fallback bytes; placeable-WMF admission is a specific exception, not general SVG/EMF decoding/editing.                                                               |
| F35 | Image extraction          | read     | Exact original bytes with safe names/manifests; explicit transactional or partial publication required.                                                                            |
| F36 | Charts                    | edit     | Bounded category/XY/bubble families and live object edits; unsupported extensions retained, not arbitrary chart creation.                                                          |
| F37 | Chart formatting          | edit     | Live titles/legend/axes/ticks/plots/series/markers/labels/font/drawing subsets; case-by-case payload review remains open.                                                          |
| F38 | Workbook-backed charts    | edit     | Simple embedded data/cache/range synchronization and builders; no formula evaluation or external data fetch.                                                                       |
| F39 | Advanced charts           | preserve | Unsupported chartEx/advanced substructures retained; no silent conversion or full semantic editing claim.                                                                          |
| F40 | SmartArt                  | preserve | Diagram resource graph/fallback inventory and supported import closure; no semantic layout engine.                                                                                 |
| F41 | Equations                 | edit     | OMML inspection/extraction and validated authored insertion; set/remove/typesetting/evaluation unavailable.                                                                        |
| F42 | Audio/video               | edit     | Explicit inert bytes/posters, insertion/replacement/extraction and metadata; no playback/transcoding proof.                                                                        |
| F43 | Captions/media extensions | read     | Caption/track metadata inventory and retention; uncommitted track-editing work excluded, no independent playback evidence.                                                         |
| F44 | Transitions               | edit     | Cut/fade/push/wipe and explicit timing; unsupported/Morph/sound content retained.                                                                                                  |
| F45 | Animation inventory       | read     | Timing nodes/triggers/targets inspected without execution; not playback equivalence.                                                                                               |
| F46 | Animation editing         | edit     | Appear/fade-in/fade-out/pulse, simple triggers/sequences; complex timelines retained and unsafe edits rejected.                                                                    |
| F47 | Hyperlinks/actions        | edit     | Ordinary URL/slide navigation; other actions inert and retained, never executed.                                                                                                   |
| F48 | Notes                     | edit     | Speaker body and explicit scoped notes/master text; competing master imports reject and whole live notes API remains incomplete.                                                   |
| F49 | Handouts/print            | edit     | Handout inventory and explicit master text replacement, notes size; print/view retained without pagination.                                                                        |
| F50 | Comments                  | edit     | Legacy comments with explicit author/time/position; modern threads/mentions/reactions retained.                                                                                    |
| F51 | Metadata/tags             | edit     | Core/typed custom properties and supported tags; unknown/custom XML retained, shared tag edits reject.                                                                             |
| F52 | Accessibility             | edit     | Alt/decorative metadata, title checks and structural order; no accessibility certification or contrast/visual-order proof.                                                         |
| F53 | Embedded content          | edit     | Opaque inventory/extraction plus inert OLE byte insertion; controls/web/3D preserved without activation or recursive parsing.                                                      |
| F54 | Fonts                     | preserve | Font declarations and embedded bytes inventoried/retained; no installation, rendering or license assurance.                                                                        |
| F55 | Security/signatures       | read     | Marker detection and bounded mutation refusal; no cryptographic validity, full rights interpretation or complete signature-removal claim.                                          |
| F56 | Sanitization              | edit     | Explicit supported property removal only at this commit; broad sanitization work in the working tree is excluded.                                                                  |
| F57 | Templates                 | edit     | Explicit text/fixed-table/image bindings and repeated slides; not create --template support.                                                                                       |
| F58 | Batch                     | edit     | Ordered animation add/set/remove only; general property/model batches and handles unavailable.                                                                                     |
| F59 | Diff                      | read     | Structural/text/media/relationship/raw-format differences; effective-formatting mode rejects, no visual diff.                                                                      |
| F60 | Package tools             | edit     | Explicit bounded extract/pack/XML replacement and semantic validation; validator says schema not-checked, standalone validate CLI remains a gap.                                   |

## Every source case and public member remains accountable

Fresh pointer/identity/location/revision joins cover 2,700 unit variants and 973
expanded BDD examples, each with a unique original TypeScript obligation in
[the central ledger](test-case-map.json). Parameter/example rows are not collapsed.
The source inventory's unmapped labels and [test audit](upstream-test-audit.md)
“adaptation not started” header are historical baseline statements, not current
package status. The ledger is the later disposition record.

| Disposition                      |                Count |
| -------------------------------- | -------------------: |
| Adapted passes recorded          | 43 (26 unit, 17 BDD) |
| Semantic review required         |                2,585 |
| Specified but not implemented    |                  167 |
| Proposed design, not implemented |                  877 |
| Explicit public deferral         |                    1 |
| Architecture-only exclusions     |                    0 |
| Total source cases               |                3,673 |

Thus 3,630 cases remain open/deferred in the broad sense; only one has the exact
deferred-public-behavior label. The 43 recorded passes comprise 12 byte-reader
and 31 axis-crossing obligations. Later family receipts need exact assertion and
parameter review before central promotion. No case is promoted by this checkpoint.
Reserved TypeScript IDs and proposed original wording are obligations, not tests.

All 2,409 [API inventory](upstream-api-inventory.json) identities have destinations
in 2,426 [target rows](public-api-map.json), including 17 added bounded-view members.
All 425 records with underscore-prefixed public path components remain in scope.
Inherited members, enum values/aliases, collections, helpers and APIs without
source tests retain independent acceptance obligations. These counts are not a
verified implemented-member census.

## Exact language/security mappings and resolved drift

The detailed [J01–J10 register](api-language-mappings.md) and
[mapping table](office-cli-qa-review.md#exact-mapping-decisions-used-by-qa) remain
the exact target contract. Neutral model snake_case stays primary; positional
order/defaults remain, keyword-only arguments use trailing typed options and
reserved positional `default` binds as `default_value`. Operation JSON separately
uses camelCase. Live synchronous properties/methods retain owner identity;
factories/save/binary admission always return Promises, even for bytes.

SDK sequences are checked zero-based positions; sparse placeholder IDs are keys.
Only declared collections support negative `.at` or stepped end-exclusive slices;
zero step raises ValueError. CLI ordinals remain one-based. Undefined selects
defaults; null denotes only permitted absence/inheritance, distinct from false,
zero and empty text. Lengths use safe integer EMUs and ties away from zero;
centipoint access floors division by 127. RGB parsing requires six hex digits.
UTC metadata dates drop subseconds; chart calendar serials use the separate
documented 1900/1904 epochs. No clock or implicit revision increment is introduced.

Binary inputs/results are owned bytes or explicit capabilities. Font fitting uses
admitted metrics, never a host font path. Bounded XML/package views replace arbitrary
XPath/dependency APIs. Neutral typed error classes/codes remain those in J08;
invalid primitive property access is not an SDK error wrapper. Shared ordinary exit
statuses are 0/1/2/3/4/130; diff uses 0 equal, 1 different, 2 failed, 130 cancelled.
The common version-1 envelope, flags, selectors, schema and capabilities remain
required. Product network/native runtime/ambient host authority remain prohibited.

The [API audit](upstream-api-audit.md) resolves module-path drift, incorrect chart/
movie returns, the documented background setter discrepancy, nonexistent freeform
close/cell-coordinate members and enum/color/fill corrections. Keep corrected
GraphicFrame/Movie returns and PERCENT_40, without inventing aliases for errors.
Those pinned documentation observations are not a new live-site review.

The committed exports now include Presentation, live slides/layouts, chart and
media models and builders: earlier absence statements apply only to their dated
receipts. Conversely, the proposed command register is not executable schema.
The committed parser confirms row,column cell grammar; batch capabilities confirm
animation-only scope. The [built QA receipt](office-cli-execution-20260913.md)
also records template/validate and legacy-error-hint gaps. Its dirty-tree/built-adapter
execution is historical, not a clean-commit acceptance run here. Required plural
images/tables/properties and text replace remain the shared contract; drift does
not authorize changing that contract to match the implementation.

## Original regression evidence and independent limits

Committed original security-admission tests build in-memory packages and assert
macro/signature rejection before mutation, typed errors and unchanged input bytes.
The prior audit records 18 passing security cases. Committed freeform tests assert
live offset changes and returned operation behavior; prior receipts record seven
passes. Committed collection-boundary tests guard negative numeric brackets. These
are bounded regressions, not downloaded fixtures or whole-API equivalence.

The [retention review](evidence-retention-review.json) records 6,874 package passes
and successful lint on an earlier working tree containing concurrent changes.
That result is not assigned to the inspected clean commit. No runtime tests ran
in this documentation-only checkpoint. The crossed value/series label design
remains open: equal values for every flag and opposed value/category flags do not
prove both required value/series combinations through save/reopen.

Eight [corpus regression designs](corpus-gap-regressions.json) remain explicitly
unimplemented in that ledger. The large campaign still records slide-count
admission and cancelled-JSON-envelope findings, plus timer-delivery instrumentation
work. Their small original reductions are specified in the plan; none becomes a
passing regression merely because it has a design. New product tests/fixes are
outside this task.

No independent slide renderer, playback application, font configuration or
before/after visual comparison was exercised here. Historical terminal screenshots
test CLI presentation only. Structural retention/hash checks do not prove media
playback, chart appearance, bidi shaping, font fallback, animation timing or
OOXML schema conformance. The semantic validator explicitly returns
`schema: "not-checked"`; input capabilities explicitly return `complete: false`.

## Retention, legal notices and delivery boundary

The [corpus manifest](corpus-manifest.json) lists 14 disposable QA documents,
643,143,571 bytes total. This checkpoint reads metadata only: no binary acquisition,
execution, rehashing, deletion or absent-download test is claimed. Existing campaign
closure is unverified, so fixtures and reference checkouts remain untouched.
Canonical tests must use original in-memory assets, never downloads. No fixture
is staged or shipped by this change.

Existing standalone [case](test-case-map-notice.txt), [API](public-api-map-notice.txt),
[baseline](upstream-license-notice.txt) and package THIRD_PARTY_NOTICES.txt notices
remain intact. Reference identities/links stay in research/provenance and required
legal notices; no branding, source, comments, identifiers, tests or assets change.

README edits still require permission. Usage drafts remain under docs/pptx;
no package README parity is claimed. Some required baseline/shared-contract inputs
are preexisting untracked files (enumerated in the receipt), so this local commit
does not make those dependencies available in a clean checkout. They are preserved
and are not staged as owned work. Local commits, remote delivery and releases are
separate: this task authorizes local documentation commits only, with no push or
publication.

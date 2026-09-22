# Text and layout extraction — draft qualification

Task scope: `pdf-extraction-layout`. Original first-party implementation in the
existing private `packages/pdf-parser`, separate from `packages/pdf` rendering.
No upstream code/assets were adapted and no dependency was added. Runtime
manifest remains private with an empty dependencies object. No native oracle,
LLM, filesystem fixture or ambient asset/network acquisition is used.

## APIs and ownership

- `extractPdfLayout(bytes, resources, options)` admits/snapshots bytes through
  SyntaxReader and uses explicitly supplied object/stream capabilities.
- `document.extractPageLayout(index, options)` selects a zero-based ordered page,
  inherits its CropBox/Rotate and shares the document's owner.
- `document.extractLayout(options)` inventories once and returns ordered page
  results plus byte-preserving metadata and page inventory. Content extraction
  consumes already selected pages without repeatedly traversing the page tree.
- Public exports include layout/result/run and document/page-option types.

Glyphs retain original codes, Unicode interpretation, raw strings and mapping,
PDF-space origins/advances, matrices and content-stream/form provenance. Runs
provide glyph index ranges, mapped Unicode and rotated display baseline
origin/end/direction. These are not font ink rectangles. Display coordinates
start at the selected box's upper left; x is rightward and y downward. CropBox
selection does not imply clipping-aware text visibility. Unknown metrics remain
unknown; geometryComplete reports incomplete glyph origins/advances.

## Deterministic policies

Logical mode defaults to semantic content order with ActualText replacement.
It does not synthesize reading order. Content mode concatenates mapped glyph
Unicode in content-stream order, retaining drawn glyphs under ActualText.
Layout mode sorts string runs by floor(displayY / lineTolerance), then displayX,
then original glyph index. Known positions precede unknown positions, which keep
source order. Fixed bands make the comparator transitive; tolerance proximity
comparators can violate that property. Cross-band runs gain a newline; same-band
runs gain one space only when their measured x gap exceeds lineTolerance and
neither adjacent string already supplies a space. Literal whitespace is retained.
The tolerance is in PDF units, default 2. Row-band identifiers must be safe
integers; unsafe coordinates/division fail explicitly rather than aliasing bands.

RTL code order and vertical string order remain source order. Run directions
preserve negative horizontal and vertical advances, including rotated advances.
There is no Unicode bidi or script shaping operation. Ligatures/multi-scalar
mappings remain intact; preserve/NFC/NFKC is explicit and affects only the final
projection. Geometry mode uses drawn glyphs rather than substituting ActualText
into baseline segments. Consumers can use raw replacements separately.

Columns and tables receive deterministic row order, not inferred column reading
order or structural cell reconstruction. Author intention, structure-tree order,
paragraph discovery, adaptive line/word grouping, script-specific bidi,
clipping/visibility and font-ink bounds remain unqualified. Synchronous work can
observe pre-aborted signals or capability-triggered aborts; event-loop aborts
cannot execute concurrently with scanning. No claim of mature PDF or Poppler
parity is made.

## Bounds and fatal failures

Input/object interpretation, run records, Unicode staging/joining/normalization,
rotation, row admission and comparator work use the same cumulative owner.
maxRuns defaults to the owner's object limit and bounds each page's run count;
retained allocation/work also bound the total document result. Quotas do not
reset between pages or repeated calls. Allocation charges are a conservative
admission model rather than measured JS heap consumption. Sorting uses bounded
native array storage and charges each comparison. Coordinate overflow, invalid
policies, limits and cancellation propagate as fatal failures. Diagnostics are
carried through unchanged; unknown mappings never become guessed text.

Image XObjects are skipped as images without decoding their unsupported image
payload. An image-only PDF therefore has zero text and needs the separate OCR
plan; malformed content and unsupported inline images remain separate errors.

## Independent acceptance controls

Original in-memory tests assert manually chosen expected results for shuffled
strings and glyph indexes; source/semantic/layout mode differences; ActualText;
all four rotations and unchanged original coordinates; negative horizontal RTL
advances and Hebrew scalar order; ligature preservation versus explicit NFKC;
vertical CID metrics/rotated direction; literal spaces and adjacent strings;
two-column/table row ordering; fixed-band ties and configurable tolerance;
unknown widths; zero run/work limits; invalid and overflowing policy arithmetic;
image-only document extraction; metadata/page order and content-stream provenance;
exact cancellation identity and repeated-call cumulative allocation exhaustion.
A failing inventory-count control demonstrated repeated page-tree traversal
before content extraction was factored around an already selected page.

The tests use no native process or disk fixture and make no prerequisite-gate
qualification claim. Existing revision/filter/security/font tests continue to
run unchanged alongside these controls.

## Command and artifact boundary

The requested command-package pattern was read at its current archived path:
`docs/plans/archive/safe-bash-command-package-pattern.md`. The maintained private
engine → private command → safe-bash dependency direction applies. No dependent
command is enabled and no command parity/output/registration gate is closed.
When dependent commands consume these APIs, required first-party source and
licenses must be bundled by maintained safe-bash artifact routes with no private
ambient runtime import. This increment does not prove installed safe-bash
bundling, conditional realm identity, browser/workerd/Bun or replay execution.
No CLI presentation changes were made, so screenshot QA is not applicable.

Pinned research references remain PDF.js
579c4b700f23f7782234f03358b5e9eaa3f58889 (Apache-2.0), pdf-lib
93dd36e85aa659a3bca09867d2d8fac172501fbe (MIT), qpdf
54d6053af283bbeb8b325f4886c0f65cc51f2b80, MuPDF
89c1d183a7fb724898b2017d6ecd402a61886d4f (AGPL/commercial) and Poppler
0595ca8e76f575e5f16ccc5ee6d4b552d31b0a46 (GPL). These pins are research
provenance, not adopted source. The package's first-party MIT license is retained.

## Local verification

- Maintained package unit route: 151 passing, zero failures/skips/cancellations.
- Maintained package lint and production/test typechecks: passed.
- Selected maintained workspace build closure: passed.

No local commit, verified remote-main delivery or successful release is claimed.
Prerequisite qualification and dependent command adoption remain independent.

Built-entry checks from `pdf-extraction-layout-candidate-qa.md` passed on Node
22.22.2: foreign VM-realm byte storage, nonzero CropBox and negative rotation,
preserved original glyph geometry, imitation-byte rejection and exact
capability-triggered cancellation. Built layout imports are local first-party
modules only. Repository-wide checks were not run for this package-confined
increment. Tracked `git diff --check` passed; the parser directory was already
untracked at task start.

## Task review — 2026-09-21

Reviewed extraction/layout composition, run grouping, coordinate overflow,
fixed-band sorting, allocation/work admission, cancellation, provenance and
the portable runtime import boundary against the current candidate. No validated
finding or test-supported simplification was identified within this task's
capability. No parser code or other contributors' changes were modified.

Fresh package unit verification passed all 151 tests with zero failures,
skips or cancellations. Package lint, production/test typechecks and the
selected maintained workspace build passed.
Built-entry controls passed for foreign-realm bytes, nonzero CropBox/negative
rotation, retained original coordinates, imitation-byte rejection and exact
capability-triggered cancellation. These are candidate API controls, not
installed-artifact, snapshot/replay or mature compatibility qualification.
The independent gates and runtime limitations above remain unchanged.

## Reproducible candidate receipt — 2026-09-21

Fresh verification used checkout HEAD
`ab1fa8d34101e1e7f61272973f3bc28a842043d8` plus the existing working tree,
on Node 22.22.2. The parser source/test snapshot SHA-256 is
`c98d0e5b642245544e5c74fac0fcb2a7395f4640051c6225f6076a4dfd76e3bb`.
To reproduce the digest, sort all `src/*.ts` basenames lexically and hash each
basename, NUL, exact file bytes, NUL in sequence. HEAD alone does not identify
this working-tree candidate.

- `npm run test --workspace=pdf-parser`: 151 passes; zero failures, skips,
  cancellations or TODOs.
- `npm run lint --workspace=pdf-parser`: passed ESLint and both production/test
  TypeScript checks.
- `npm run build:workspaces -- --workspace=pdf-parser`: passed the maintained
  selected build closure.
- Manual built-entry QA: foreign VM-realm input, nonzero CropBox, negative
  rotation, original glyph geometry, imitation-byte rejection and exact
  capability-triggered cancellation passed. An independent shuffled four-cell
  control produced `DBCA` in logical/content modes and `A B\nC D` in layout
  mode. Zero work and zero retained-byte budgets failed fatally with `LIMIT`.
- Private manifest and empty runtime dependencies were confirmed. Built
  layout/text/font imports reach only local first-party modules.

The first additional budget QA invocation failed because the control used
`allocationBytes`, which is not a declared `PdfLimits` field. Inspection confirmed
the API field is `retainedBytes`; the complete built-entry control set was then
rerun successfully with that field. This was a QA-control error, not a validated
parser defect. No code change or prerequisite/dependent gate closure resulted.

Repository-wide checks were not run for this review confined to the parser.
Actual browser/workerd/Bun runtime cells, installed safe-bash artifacts,
original/checkpoint/replay execution and mapped upstream compatibility remain
unverified. CLI/SDK command parity and screenshots are not applicable because
no command behavior or presentation was changed. No commit, push or release
was performed.

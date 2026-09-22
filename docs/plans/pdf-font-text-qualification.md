# Font and text interpretation — draft qualification

This is an original first-party font/text increment in the private `pdf-parser`
workspace. It does not close revision, filter, security, command extraction,
layout, rewriting, or full PDF 1.0–2.0 gates. No upstream implementation or asset
was copied, no external parser was adopted, and no dependency was added.

## Interfaces and ownership

`tokenizePdfContent(bytes, options)` returns source offsets and byte-preserving
object operands. `interpretPdfText(bytes, resources, options)` consumes explicit
object/stream capabilities. `document.extractPageText(zeroBasedIndex, options)`
uses the document's page, object and stream gates and shares its cumulative
work/allocation/cancellation owner. It neither reads files nor acquires assets.
The returned projection is content-stream order, without inferred spaces, line
breaks, bidi, reading order or page orientation adjustment. Page rotation and
boxes remain in the independent page inventory.

Glyphs retain raw code bytes, code/CID/glyph identity, mapped Unicode, raw
ToUnicode destinations and local mapping offsets, mapping category,
font dictionary, text transform, origin/advance, original string object and byte
index, operator offsets and recursive form path. Page extraction supplies joined
stream spans and per-string stream provenance. Form-local offsets refer to the
decoded form stream, identified by its path; they are not original compressed
file offsets. Raw compressed stream bytes remain available through document APIs.
Missing simple-font widths produce UNKNOWN_WIDTH diagnostics and unknown
advances; subsequent origins/transforms remain unknown until explicit text
positioning restores them. They are never presented as zero-width geometry.
Type3 mapping remains available, but its unqualified metrics remain unknown.
Logical replacement scopes retain their original ActualText string and glyph
extent. Glyph text remains available even when the logical projection replaces it.

## Candidate controls

Original in-memory fixtures exercise:

- Graphics save/restore and CTM, text/line matrices, widths and TJ adjustments.
- Tj/TJ and basic text state operators; explicit source-order glyph projection.
- StandardEncoding, WinAnsiEncoding, MacRomanEncoding and checked Differences.
- Strict `uni`/`u` glyph-name grammar, suffixes and underscore components; unknown
  names never fall back to the raw character's readable spelling.
- Type0 Identity-H/Identity-V and explicitly supplied character-to-CID CMaps;
  CID W/DW and W2/DW2 positioning.
- ToUnicode bfchar/bfrange, array/sequential destinations, code spaces,
  multi-scalar/supplementary text, strict surrogate validation and range quotas.
- Embedded sfnt Unicode cmap formats 4/12 with bounded reverse Unicode mapping
  and CID-to-GID selection. Ambiguous reverse mappings remain unresolved.
- Direct/named property dictionaries, nested and empty ActualText, original
  replacement bytes, form resources/transforms, recursion cycles and text scope.
- Explicit normalization, cancellation propagation and cumulative document limits.

The unit suite uses no filesystem fixtures, native oracle process or LLM.
Reference-native results in the task are research evidence, not current-engine
parity claims. Candidate qualification remains draft, including runtime cells
beyond this local Node execution.

## Deliberate semantic policy

Unicode is preserved by default. NFC/NFKC only changes the selected final logical
projection; glyph Unicode remains unchanged. Adobe-style ligature names retain
presentation-form ligatures, with no Poppler pass-specific compatibility repair.
`uni` names are scalar chunks, not ToUnicode surrogate-pair strings. Invalid
names remain unmappable; numeric-name and raw-code repair heuristics are absent.
Font encoding determines character boundaries; a ToUnicode code-space range
cannot change simple-font one-byte or Identity CID two-byte segmentation.
Malformed ToUnicode UTF16 is a fatal strict syntax error, with caller input
unchanged. Partial ToUnicode maps do not silently fill from font encodings.

ActualText applies to any string-valued marked-content property, rather than
Poppler's Span-only producer profile. Nested scopes use outermost replacement
when that outer scope closes; an inner scope does not erase the outer scope's
state. Empty drawn replacement suppresses glyph projection, an empty scope emits
nothing, and unclosed scopes retain glyph text with explicit diagnostics.
Unmatched EMC is a strict syntax failure. These choices intentionally differ
from the supplied native controls; no native-compatibility mode is claimed.

## Limits and open cells

The syntax owner admits/snapshots input and charges token/object staging,
work and conservative retained allocation before bounded operations. CMap range
expansion and embedded cmap work additionally use `maxMappings`; XObject,
graphics and marked-content recursion use the owner's nesting ceiling. Quota
and cancellation errors propagate, including capability failures; they never
become text warnings. Synchronous execution can observe an already-aborted
signal or aborts triggered by capabilities; event-loop cancellation cannot run
concurrently with synchronous scanning.

External named CMaps and usecmap inheritance are unsupported; there is no URL,
worker asset or host font fallback. Inline images fail explicitly rather than
using an unsafe substring EI search. Type1/CFF embedded program interpretation,
complete Adobe glyph-name assets, Symbol/ZapfDingbats, complete Type3 character
program interpretation, standard-font metrics, complex shaping, clipping-aware
visibility, optional-content/structure-tree interpretation and encrypted text
integration remain open. Unknown operators/fonts produce diagnostics and must
not be treated by downstream consumers as a fully qualified projection.

Dependent command exports follow the existing private first-party source
bundling boundary. The requested command-package pattern currently resides at
`docs/plans/archive/safe-bash-command-package-pattern.md`; it was read there.
This task adds no command export, registration, external runtime import or
published parser package, and does not enable pdftotext's downstream extraction
gate. Required source bundling applies when that separate integration is wired.

Pinned research references: PDF.js
`579c4b700f23f7782234f03358b5e9eaa3f58889` (Apache-2.0), pdf-lib
`93dd36e85aa659a3bca09867d2d8fac172501fbe` (MIT), qpdf
`54d6053af283bbeb8b325f4886c0f65cc51f2b80`, MuPDF
`89c1d183a7fb724898b2017d6ecd402a61886d4f` (AGPL/commercial), Poppler
`0595ca8e76f575e5f16ccc5ee6d4b552d31b0a46` (GPL). These are reference pins,
not adoption authorizations or copied-code provenance.

Encoding slot checks were cross-checked against pinned PDF.js
`src/core/encodings.js`, including WinAnsi bullet/space/hyphen slots and
MacRoman Omega/space/currency slots. The implemented scalar records are
first-party format data; no host charset decoder is used for font codes.

## Local verification

- `npm run test --workspace=pdf-parser`: 134 tests passed, including 35 original
  font/text controls; zero failures, cancellations or skipped cases.
- `npm run lint --workspace=pdf-parser`: passed ESLint and both maintained
  production/test TypeScript checks.
- `npm run build:workspaces -- --workspace=pdf-parser`: passed the selected
  maintained workspace build closure.
- `git diff --check`: passed for tracked changes. New source files were also
  formatted and covered by package lint/type checks.

No commit, remote-main delivery or release publication was performed by this
increment. No CLI visual behavior changed, so no screenshot gate was triggered.

## Task review

Three findings were reproduced with failing in-memory tests and fixed:

- Differences names matching inherited JavaScript object properties could emit
  function text. Glyph-name lookup now admits only owned table entries.
- Finite text transforms could still produce infinite transformed advances.
  Advances now receive the same strict overflow admission as text matrices.
- Malformed BOM-prefixed UTF8 ActualText escaped as a platform TypeError.
  It now reports a parser SYNTAX error without replacing invalid bytes.

The review covered content/font mapping, page extraction ownership, capability
cancellation, mapping and recursion budgets, source provenance and normalization.
No runtime dependency or ambient file/network access was introduced. Public
entry functions establish byte admission or option policy; no proxy-only layer
or test-supported abstraction removal was identified. Result shape and default
normalization remain unchanged. The affected package tests, lint/typechecks and
selected maintained workspace build were rerun after fixes.

No unresolved finding remains from this task review. The unqualified feature
and runtime cells listed above remain open; this receipt does not close those
independent gates or claim mature font/text parity.

## Additional candidate review — 2026-09-21

The font/text implementation was already present in the working tree at the
start of this review. Two independent negative controls failed before fixes:
Type0 without its required Encoding silently inferred Identity boundaries, and
sfnt format 4 accepted odd idRangeOffset values, potentially reversing an
unaligned glyph ID into readable Unicode. Both now raise strict SYNTAX errors.
Missing Encoding is rejected before acquiring a ToUnicode stream. Valid
dictionary base encodings and an aligned glyph-array offset are passing controls.
The existing out-of-bounds glyph fixture now uses even offset 254 instead of odd
255 so it continues testing span admission independently of alignment admission.

The first complete package run after the fixes reported 136 passes and one
failure: that older fixture expected the span diagnostic but received the new
alignment diagnostic. After separating its condition, the complete maintained
`npm run test --workspace=pdf-parser` passed all 137 tests with zero failures,
skips or cancellations. `npm run lint --workspace=pdf-parser` and
`npm run build:workspaces -- --workspace=pdf-parser` also completed successfully.
No timeout or incomplete maintained package run remains.

Manual QA from `docs/plans/pdf-font-text-candidate-qa.md` passed against the
built portable entry on Node 22.22.2: foreign VM-realm input bytes, preserved
glyph bytes/coordinates, unsigned four-byte CMap arithmetic, supplementary
Unicode, authoritative partial mapping without segmentation changes, imitation
byte-object rejection, exact cancellation reasons and fatal zero-work limits.
Portable text imports remain local first-party modules and the manifest still
declares no runtime dependencies. No native PDF oracle was invoked.

SHA-256 identifiers for the changed executable candidate:

| Source | SHA-256 |
| --- | --- |
| src/text.ts | e24e3b0e8f81ee78a4a4d6f90e7f0dccb7f05ce493ce5cd2580061815d8b2632 |
| src/font-cmap.ts | 6ba3f4a5f8a23565b2e4424eaa9e094613bdc345f18c9b1df71436e071b39ae5 |
| src/text.test.ts | e9c9176c809a75ed6f20347d8cc5fec4f5f777ae8a2a148bc1d3ddd929b6774a |

These identify local files under packages/pdf-parser, not a committed revision.
The change is confined to font/text admission and its tests; repository-wide
test/lint/build were not run. No visible CLI change triggers screenshot QA.
Actual browser/workerd/Bun execution, command exports, installed source bundling
and original/checkpoint/replay execution remain unverified separate gates. No
commit, verified remote-main delivery or successful release is claimed.

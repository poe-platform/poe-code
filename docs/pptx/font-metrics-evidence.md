# Portable font measurement evidence

This receipt implements the metric prerequisite for F19, not document fitting,
full international shaping, or whole public API coverage. The internal module
is `packages/pptx/src/font-metrics.ts`; it has no package-root export or new CLI
editing route. `TextFrame.fit_text` and `text fit` remain pending together.

## Contract and exact language/security mapping

`admitFontMetrics` accepts original caller-supplied data: exact case-sensitive
family, explicit boolean bold/italic, integer units-per-em, integer line height,
and a scalar-to-integer-advance dictionary. Data is copied into a private map;
an immutable identity handle must originate from admission. Object spreading or
structurally forging a handle fails. Host file paths, ambient font collections,
renderers, font installation and fallback discovery are never consulted.

`measureText` takes explicit identity, integer point size and available point
width. `bestFitText` additionally takes height and a maximum integer point size.
No model defaults are redefined by these internal helpers. The eventual model
retains `fit_text(font_family = "Calibri", max_size = 18, bold = false,
italic = false, font_file = null)` spelling/defaults, with admitted metrics in
place of the path and/or supplied context, as specified by J01/J07. No underscore
prefixed documented public type is excluded by this prerequisite.

Missing exact font identity or scalar metrics fails `OfficeError` with
`unsupported-edit`. Optional `missingGlyph` explicitly selects an admitted scalar
advance to substitute for missing advances and reports the replacement count;
it neither rewrites text nor guesses a font. Invalid values and forged handles
fail `invalid-value`; exceeded budgets fail `resource-limit`. Lone surrogates fail
rather than being replaced implicitly. All functions are synchronous and pure
apart from privately retaining the admitted table; there are no I/O capabilities.

The portable profile is additive scalar advances, without kerning, shaping,
ligatures, ink bounds, bidirectional reordering or automatic CJK breaks. Combining
marks and supplementary scalars use exactly their supplied advance (including
zero). The caller must select this profile deliberately; it does not promise
renderer-equivalent complex-script placement. Width is advance width; height is
supplied line height times the line count, scaled by size / units-per-em.

Whitespace U+0009–000D, U+001C–0020, U+0085, U+00A0, U+1680, U+2000–200A,
U+2028–2029, U+202F, U+205F and U+3000 collapses to single interword spaces,
including newlines. Leading/trailing separators disappear. Whole words wrap
greedily; an overlong word remains intact and reports overflow. Empty text has
zero lines. Largest-fitting selection is inclusive, searches integer sizes
1..maxSize, and returns null if none fits. No-fit is an explicit result instead
of a renderer/private-helper exception. Metrics are resolved before searching,
so missing glyphs cannot be hidden by an early overflow result.

## Bounds

Hard ceilings: 65,536 admitted enumerable glyphs, 65,536 UTF-16 text code units,
4,000,000 work units, 256 family code units, 1,000,000 per metric integer,
4,096 point size, and 1,000,000,000 point extent. Units-per-em and line height
are positive; advances and extents may be zero. Callers may only lower budgets.
Work is charged for every input scalar, every visited word in every candidate
layout, and every size-search iteration. Candidate visits share one budget.
The bounded numeric products remain below the JS safe-integer ceiling; point
conversion uses ordinary floating-point division, not rasterizer rounding.
Metric descriptors cannot invoke accessors. Proxies are not a sandbox boundary:
callers must supply plain already-acquired data, as for other in-memory APIs.

## Provenance and case reconciliation

Reviewed [the pinned test audit](upstream-test-audit.md),
[all case identities](upstream-test-inventory.json),
[the API audit](upstream-api-audit.md), [API inventory](upstream-api-inventory.json),
and [the counterpart audit](../docx/upstream-test-audit.md). Shared OPC/XML/image
admission remains owned by the existing package layer; font metrics do not parse
archives, XML or images and do not introduce a competing shared codec.

Pinned baseline: `278b47b1dedd5b46ee84c286e77cdfb0bf4594be`.
Source inspection used `tests/text/test_layout.py`, `tests/text/test_fonts.py`,
`src/pptx/text/layout.py` and the recorded API signatures. The layout suite's
commented raster-size assertions explicitly document platform differences.
Supplied advances and line height replace Pillow/font-file measurements; those
platform raster sizes are not counted as identical or passing TS cases.

The [per-case supplemental map](font-metrics-case-map.json) keeps every font and
layout parameter variant, plus the frame-fitting and BDD integration obligations.
Original fixtures use Harbor family metadata and independently chosen advances;
width 49/50/51 versus 50 and height 99/100/101 versus 100 preserve the audited
boundary values. The 36-of-42 maximum is verified with original text and metrics.
Tree shape, mock call counts and file-table plumbing map to explicit architectural
or security differences, not false public API exclusions. BDD/frame mutation
obligations stay deferred. The older audit's “adaptation not started” is a
historical baseline, superseded only for this prerequisite by this receipt.

No implementation, prose, font bytes, binary fixtures or assets were copied from
the reference. The existing standalone research MIT notice remains retained;
this original implementation needs no additional derived-material notice.
No QA inputs were downloaded, cloned, removed or made canonical dependencies.

## Verification

Initial TDD failed on the absent module. Original tests use memfs metric JSON,
then independent numeric expectations for wrapping, bounds, identity, missing
metrics, immutable admission and cumulative work. Maintained check results are
recorded in the associated plan after execution. No visual CLI surface changed.

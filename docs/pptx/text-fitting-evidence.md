# Supplied-metric text fitting evidence

F19 now has a bounded document-fitting operation in `packages/pptx`, separate
from metadata-only `text frames set --autofit`. This receipt supersedes the
integration-pending statements in the earlier font-metric receipt and ledger.
It does not claim full model-graph, whole-public-API or rendered-slide parity.

## Public contract and language/security mapping

`admitFontMetrics(data)` synchronously copies a closed scalar metric document into
an immutable handle. Family, bold and italic must match exactly; missing fonts,
metrics or glyphs fail explicitly. There is no host filesystem/font discovery,
process, network, font substitution or hidden rasterizer. See the earlier
[metric admission receipt](font-metrics-evidence.md) for hard admission budgets.

`TextFrame.fit_text(font_family = "Calibri", max_size = 18, bold = false,
italic = false, font_file?: FontMetricsHandle | null,
options?: ModelTextFitOptions): void` retains the documented neutral member,
positional defaults and void return. The fifth argument replaces unrestricted
font paths with an admitted capability (J01/J07). The optional sixth argument
adds minSize, four margins, wrap and lineSpacing. Detached frame construction
accepts a copied `{width, height}` in points; missing extents fail explicitly.
This existing detached model is not a claim of implemented live shape-owner APIs.

`fitTextFrames(input, options, context)` is always async and returns bytes,
affected frame count, fingerprinted locations and selected integer sizes.
Its options use camelCase (`fontFamily`, `maxSize`, `minSize`, etc.) and require
`metrics: FontMetricsHandle`. Package fitting derives local shape extents in
points from integer EMUs. Missing local extents, multi-column/vertical/rotated
frames, direct bullets, tabs, indentation, character spacing/baseline or
capitalization effects outside the scalar profile fail explicitly. Table cells
are excluded, matching existing frame editing. No inherited-geometry or complex
shaping support is implied.

`text fit` calls that same SDK operation. `--metrics` carries a closed JSON
metric document, admitted before package reading. Generated `schema text fit`
and `capabilities` describe the operation. Required-metric omission is CLI usage
status 2; admitted missing-font/glyph or impossible-fit errors use status 1.
Invalid values/forged handles use `invalid-value`; limits use `resource-limit`.
Shared selection, JSON envelope, dry-run, output/in-place, force, stdin and
publication contracts come from the existing command engine and adapter.
Failures never publish partial edits. All required source/public inventory rows
remain recorded; underscore-prefixed types elsewhere are not reclassified.

## Layout and mutation

- Integer search selects the greatest fitting size in inclusive minSize..maxSize;
  defaults are 1..18pt. Document maximum is 4000pt (the internal metric helper
  separately permits 4096). The monotone binary search shares a bounded work budget.
- Available width/height subtract explicit margins or direct/default frame insets.
  Margins round once to EMUs, then the same rounded values are measured and written.
- Wrap defaults true; false measures each hard-broken line without word wrapping.
  Whole overlong tokens remain intact and must fit at the chosen size. Empty text
  has zero measured lines and receives the maximum size and paragraph-end font.
- Document fitting retains ASCII spaces and paragraph/soft breaks, including blank
  lines. Automatic wrapping consumes the separating spaces at the new line start.
  Nonbreaking spaces remain inside a token and require their own advance. The
  internal helper's older whitespace-collapse profile remains its default for
  the original normalized-layout case adaptations; document fitting opts out.
- lineSpacing is a 0.01..100 multiplier of supplied line height, rounded to the
  serialized 1/100000 unit. It replaces paragraph line spacing, with before/after
  spacing zeroed. It is not an application-specific ink-height calculation.
- All runs, fields, breaks and paragraph-end properties receive family, size,
  bold and italic. Text, unrelated run formatting and unrelated parts survive.
  Autofit becomes NONE; default wrap becomes true. Metadata-only autofit never
  admits metrics or changes font size.

## Original evidence and provenance

Reviewed the [pinned test audit](upstream-test-audit.md),
[test inventory](upstream-test-inventory.json),
[public API audit](upstream-api-audit.md), [API inventory](upstream-api-inventory.json),
and [counterpart audit](../docx/upstream-test-audit.md). Existing OPC/XML/image
behavior remains in its package; fitting reuses XML deep merges, paragraph/run
formatting, shared package admission and publication rather than adding codecs.

The [case map](text-fitting-case-map.json) retains all 73 prior metric/layout/fit
rows: 50 security mappings, 11 original metric cases, four private architecture
mappings and eight now-adapted document cases. These counts are source case
accounting, not a count of tests or proof of full API parity. The three distinct
run/break/field variants use original XML and preserve the source boolean/size
boundaries. BDD behavior is reduced to deterministic original geometry and
metrics instead of retaining a host-font-dependent numerical expectation.

New regressions cover explicit minimum, no-wrap, line spacing, empty text,
overlong tokens, exact font identity, absent glyphs, spaces, nonbreaking spaces,
hard breaks, publication isolation, CLI/SDK equal bytes, closed schemas, operation
error identity and the document font-size ceiling. All fixtures are authored in
memory; metric JSON and package I/O acceptance use memfs. No downloaded documents
or cloned binaries were added, used as canonical dependencies or deleted.
Only independently authored implementations and behavioral adaptations were
added; no substantial source implementation or fixture was copied.

## Checks and QA

The Markdown procedure is [the fitting plan](../plans/pptx-text-fitting.md).
The initial TDD failures established missing layout options, model fit_text,
CLI route/schema and later spacing/error regressions. Maintained package checks
and selected workspace build results are recorded in the plan after completion.

Application appearance remains **blocked**: `cua.getApp("Keynote")` returned
“Computer Use was not approved to use Keynote.” No alternate UI automation was
used to bypass that denial. No application-rendered screenshot, platform font
matching, or absence of clipping is claimed. Supplied scalar metrics exclude
kerning, shaping, ligatures and ink overhang, so platform-pixel equality is not
promised even after application QA. The CLI screenshot is terminal evidence only.

CLI help/error screenshot visually inspected: `/tmp/pptx-text-fit-help.png`,
SHA-256 `a157b9b55068f3d5e8951e49bdfb81bf8ee8b1380c19fac2e3952d21d3e7d0ba`.
The final image shows complete wrapped help, source defaults and the explicit
missing-metrics error, with statuses 0 and 2 through the registered virtual shell.
Foreign namespace lookalike body properties have a separate original regression;
they are preserved and cannot suppress DrawingML font updates.

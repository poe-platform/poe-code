# Chart editing draft usage

The bounded editing surface uses plural `charts add`, `charts set` and
`charts replace`. `charts list` and `charts get` remain noncreating reads.
`pptx schema charts add` and `pptx capabilities` report the executable subset.
These are draft package/command examples, not a published package claim.

```sh
pptx charts add deck.pptx --slide 1 --type COLUMN_CLUSTERED \
  --data '{"categories":["Harbor",null,"Inlet"],"series":[{"name":"Depth","values":[0,null,7]}]}' \
  --left 1in --top 1in --width 6in --height 3in \
  --style 12 --title 'Survey depths' --legend true --output charted.pptx

pptx charts set charted.pptx --slide 1 --shape 'Chart 2' \
  --style 4 --title '' --in-place --json

pptx charts replace charted.pptx --slide 1 --shape 'Chart 2' \
  --data '{"categories":["Harbor","Inlet"],"series":[{"name":"Depth","values":[2,8]}]}' \
  --workbook-policy synchronize-simple --output revised.pptx
```

Use the actual shape name from `charts list`, or its fingerprinted `--select`
token. The example name is illustrative, not a promise about its allocated ID.
CLI slide positions are one-based; shape labels are exact names and ambiguity
fails. Tokens and simple selectors cannot be mixed. Ordinary updates select one
chart; `--all` is explicit and stays within slide scope. Unmatched mutation
requires `--allow-empty`. Both output and in-place publication use the shared
stale-input and overwrite safeguards. `--dry-run` validates without publication.

Creation admits 29 explicit enum symbols: `AREA`, `AREA_STACKED`,
`AREA_STACKED_100`, `BUBBLE`, `BUBBLE_THREE_D_EFFECT`, `DOUGHNUT`,
`DOUGHNUT_EXPLODED`, `RADAR`, `RADAR_FILLED`, `RADAR_MARKERS`, `BAR_CLUSTERED`, `BAR_STACKED`,
`BAR_STACKED_100`, `COLUMN_CLUSTERED`, `COLUMN_STACKED`, `COLUMN_STACKED_100`,
`LINE`, `LINE_MARKERS`, `LINE_MARKERS_STACKED`, `LINE_MARKERS_STACKED_100`,
`LINE_STACKED`, `LINE_STACKED_100`, `PIE`, `PIE_EXPLODED`, `XY_SCATTER`,
`XY_SCATTER_LINES`, `XY_SCATTER_LINES_NO_MARKERS`, `XY_SCATTER_SMOOTH` and
`XY_SCATTER_SMOOTH_NO_MARKERS`. See the [expansion receipt](chart-expansion-evidence.md)
for independent variant assertions and explicit advanced/multi-ring limitations.

Hierarchical operation data uses `categoryLevels`, an outer-to-inner array of
equally sized string/null label arrays instead of `categories`. Dataset
`numberFormat` applies to XY x coordinates and bubble sizes; series `numberFormat`
overrides the dataset format for y/values. `categoryNumberFormat` independently
controls numeric/date category formatting. `date1904: true` selects the alternate
creation epoch; replacement retains the owned workbook epoch and rejects an
explicit conflicting choice. Neutral live-model builders remain separate public
API obligations; these camelCase fields describe operation data only.

Category arrays and series must be nonempty and category-series lengths must
match. Category order and duplicates remain intact. Empty strings are labels;
`null` means a missing point and retains its index. A series name may be empty.
Finite numeric values include zero and negative numbers; missing y-values use
`null`. Sparse JavaScript arrays, absent values, `undefined`, NaN and infinity
are rejected. Pie and doughnut require exactly one series. Scatter omits categories and uses
`xValues`/`values` pairs of equal length per series; x values must be finite and
cannot be null. Separate scatter series may have different point counts.
Bubble also supplies equal-length `bubbleSizes` containing finite nonnegative
numbers; zero is valid and null is rejected. Its depth effect is decoration,
not general 3D chart construction.

Homogeneous strings, numbers or explicit UTC-Z date strings are admitted as
categories. UTC date strings are interpreted as dates; their time-of-day is
ignored and their numeric caches use the workbook's 1900/1904 epoch. The 1900
compatibility leap-day offset is retained. Live typed date/category builders
remain separate public-model obligations; hierarchical operation labels use
the explicit `categoryLevels` field described above.

Styles are integers 1–48. Omitting a style preserves the theme default; omitting
a title creates no title, while an empty title string explicitly creates an
empty title. Legend defaults false on creation. Existing theme parts and chart
style dependencies are preserved; local metadata does not flatten effective
inherited styles.

Updating an existing title retains its layout, overlay, shape/text properties,
and rich-text body/list settings. The literal string replaces paragraph content
using whole-text-frame assignment semantics; individual run formatting is not
retained. Missing, empty and referenced title text can be assigned an explicit
empty string without deleting the title's surrounding formatting.

Chart creation owns a simple embedded workbook. Data replacement synchronizes
its worksheet, formulas and caches atomically. Both workbook policy values
reject external data, unsupported formulas, extra unrelated sheets/tables or
ambiguous ownership. Neither enables cache-only edits or formula calculation.
Unsupported structures remain preserved; they do not authorize reconstruction.
Data editing currently requires exactly one internal authoritative workbook, one
simple sheet and canonical reference ranges. It can grow or shrink series while
retaining local styles on existing series. Unknown chart extensions and
conditional style alternatives requiring unsupported reconstruction fail
explicitly. This restriction is not a whole-public-model exclusion.

The direct operation SDK uses admitted bytes and explicit context:

```ts
import { addChart, setCharts, readCharts } from "pptx";

const edited = await addChart(inputBytes, {
  slide: 1,
  type: "XY_SCATTER",
  data: { series: [{ name: "Soundings", xValues: [9, 2], values: [4, null] }] },
  left: 914400, top: 914400, width: 5486400, height: 2743200
}, context);
const charts = await readCharts(edited, { slide: 1 }, context);
const restyled = await setCharts(edited, { slide: 1 }, { style: 4 }, context);
```

Direct operation geometry uses integer EMUs. The operations return new bytes;
publication requires caller-provided authority. No implicit host I/O, native
runtime, network, workbook refresh or ambient time is used. Returned inventory
records are snapshots. This operation surface does not implement the complete
live `Chart`/axis/series/point/collection model; neutral model spellings and their
unsupported obligations remain visible in the separate API research register.

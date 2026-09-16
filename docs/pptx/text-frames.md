# Text frame configuration draft

`pptx text frames list deck.pptx --json` inspects direct formatting of shape text frames. Table-cell bodies are excluded; their cell formatting is a separate API.
`pptx text frames set deck.pptx --slide 1 --shape "Caption" --margin-left 9pt --margin-right 9pt --vertical-anchor middle --columns 2 --wrap true --vertical-text vert --rotation 15 --autofit text --output revised.pptx` writes frame metadata.

Margins use common lengths; SDK operation numbers are points. Rotation is in
signed degrees without modulo normalization; stored insets and rotation must fit
signed 32-bit EMUs and 1/60000-degree units respectively. Columns accept integers from 1 through 16. `verticalText` accepts the
DrawingML modes `horz`, `vert`, `vert270`, `wordArtVert`, `eaVert`, `mongolianVert`
and `wordArtVertRtl`. `wrap` preserves true, false and null separately. Null
removes a direct setting; omitted operation fields leave it unchanged. Direct
metadata absence is distinct from format defaults, including 0.1-inch horizontal
and 0.05-inch vertical margins.

`readTextFrames(input, options, context)` and
`mutateTextFrames(input, options, context)` use the same selection and validation
as the commands. Inputs are admitted bytes or explicitly authorized capabilities.
No implicit host filesystem or network access occurs. The `TextFrame` model
uses neutral properties `margin_left`, `margin_right`, `margin_top`,
`margin_bottom`, `auto_size`, `vertical_anchor` and `word_wrap`. Model margins
are `Length` values; operation JSON uses camelCase fields. The current bounded
XML model does not establish presentation-owner graph parity.

`auto_size` supports `MSO_AUTO_SIZE.NONE`, `SHAPE_TO_FIT_TEXT`,
`TEXT_TO_FIT_SHAPE` and null. `vertical_anchor` supports
`MSO_VERTICAL_ANCHOR.TOP`, `MIDDLE`, `BOTTOM` and null; `MSO_ANCHOR` is its alias.
Return-only `MIXED` sentinels cannot be written as a single frame setting.

Autofit changes the file's instruction to its renderer. It performs no font
measurement, changes no run size and supplies no rendering guarantee. Existing
font families, complex-script metadata, run formatting and unrelated body
attributes remain preserved by configuration edits. A text assignment has its
separate destructive content-replacement semantics and is not `text replace`.

Supplied-metrics text fitting remains a separate task and capability. It must
select the largest fitting permitted size with explicit font metrics, preserve
inclusive width/height boundary behavior and fail visibly when matching metrics
are absent. No ambient font lookup or native renderer is permitted.

The research receipt in [text-frame-case-map.json](text-frame-case-map.json)
retains all 148 selected source cases and 34 public API records, including
inherited members, enum helpers, text-content cases and deferred metrics work.
Per-row source parameter evidence remains explicit; authored tests or metadata
coverage are not claims that deferred live graph APIs or fitting are complete.
Usage remains a draft outside the README. Verification receipts and QA procedures
belong in `docs/plans/pptx-text-frame.md` and its linked CLI QA record.

Enum symbols remain numbers. `MSO_VERTICAL_ANCHOR.metadata(value)` returns
immutable `name`, `value` and `xml_value`; `MSO_AUTO_SIZE.metadata(value)` returns
immutable `name` and `value`. Anchor `from_xml`, `to_xml` and `validate` provide
bounded conversions. Auto-size is not an XML enum and does not acquire those
helpers. This is the same explicit JavaScript primitive mapping as paragraph
alignment. Model assignments of format-default insets remove the direct
attribute; operation JSON supplied insets remain explicit metadata.

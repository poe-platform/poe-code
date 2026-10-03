# Vector diagram conversion

`renderSvgDocument(svg, "pdf" | "png", options?)` converts generated SVG diagrams
without a DOM, native processes, host fonts or network access. PDFs retain vector
primitives and searchable text. PNG output uses 96 DPI by default.

The supported profile includes rectangles (including rounded corners), circles,
ellipses, lines, polygons, polylines, M/L/H/V/C/S/Q/T/Z paths, nested groups,
matrix/translate/scale/rotate transforms, solid colors, inherited stroke widths,
dashes, caps and joins, and plain text with start/middle/end anchoring. Text uses
Helvetica metrics. CSS support is limited to inline presentation properties.
View boxes use the default centered meet behavior.

Unsupported elements and selected unsupported presentation features fail
explicitly. SVG filters, clipping, masks, markers, opacity, nested viewports,
text spans/strokes, elliptical arc paths, external resources and full CSS layout
are not supported. This is a diagram primitive renderer, not a complete browser.

`SvgRenderOptions` accepts `signal`, `maxNodes` (10,000), `maxPixels` (16 million)
and `dpi` (96). XML parsing is bounded and does not expand DTDs.

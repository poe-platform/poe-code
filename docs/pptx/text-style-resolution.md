# Effective text style inspection

`readSelectionIndex(input, context).inventory.textStyles` and `pptx inspect input.pptx --json` expose the same read-only style records. The SDK call is asynchronous; input and resource limits are explicit capabilities. No host files or installed fonts are consulted.

Each record identifies a slide part, shape ID, zero-based paragraph, and zero-based run. An empty paragraph uses `run: null`. Properties are `bold`, `italic`, `size` (points), `latin`, `eastAsia`, `complex`, and `color` (six-digit RGB when resolved).

Each property reports:

- `value`: effective value, or null when absent/unresolved.
- `token`: original property or theme token, retained even when resolution fails.
- `status`: `resolved`, `absent`, or `unresolved`.
- `source`: defining part, layer and structural property path; null for absence.
- `references`: consulted color maps and theme entries.
- `reason`: unresolved cause, otherwise null.

The resolver considers run properties, paragraph defaults, shape list defaults, matching layout/master placeholders, master text styles, presentation defaults and shape font references. Slide placeholders match layout sparse indexes; layout placeholder types select master styles. Color-map overrides follow slide, layout and master precedence, including explicit restoration of the master mapping. Theme overrides replace the supplied scheme as a whole. All six major/minor Latin, East Asian and complex-script theme-font tokens are recognized.

An unknown token does not fall through to a less specific value. Empty theme font slots, unsupported color kinds and color transforms remain unresolved; no installed-font discovery or transform approximation occurs. The input XML is never modified. Resolving against a changed destination theme computes new effective values while retaining the original source token.

This inventory does not implement the planned live `Font` model, setters, script-specific supplemental font selection, shape fill/line/effect styles, table/chart styles or complete effective formatting. The conservative `effectiveFormatting: false` capability continues to mean that complete formatting inspection is unavailable. The inspect capability text describes the supported text subset.

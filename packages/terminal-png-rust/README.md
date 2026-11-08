# terminal-png-rust

Turn terminal output into shareable PNG images using independent Rust ANSI,
Unicode, font and image rendering, with no npm runtime dependencies.

| Capability | API |
| --- | --- |
| Interpret ANSI styles and terminal cursor controls | `parseAnsi` |
| Lay out colors, tabs and Unicode cell widths | `renderSvg` |
| Rasterize terminal SVG at four times zoom | `renderPng` |
| Render output and optionally publish a file atomically | `renderTerminalPng` |
| Embed regular, bold and italic JetBrains Mono faces | Font exports |
| Render a saved ANSI transcript | `terminal-png-rust` CLI |

```typescript
import { renderTerminalPng } from 'terminal-png-rust';

const png = await renderTerminalPng('\x1b[32mPassed\x1b[0m\nAll checks complete', {
  padding: 16,
  window: true
});
```

Set `output` to save the image through an exclusive temporary file and rename.
Existing temporary-path collisions are preserved; cleanup never hides the
original write or publication error.

```sh
terminal-png-rust transcript.ansi --output screenshot.png --padding 16
terminal-png-rust transcript.ansi --output screenshot.png --no-window
```

Rust interprets UTF-16 terminal cells, SGR colors/styles, erase/cursor/save/restore
controls, and portable Unicode 17 grapheme boundaries. It owns SVG layout and
embedded fonts, TrueType character maps/outlines/composite glyphs, antialiased
rasterization, PNG/Deflate encoding, render validation, output cleanup and CLI
values. Node supplies filesystem and executable transport. One napi-rs addon is
bundled; cores use std and own JSON code, with no runtime SDK or resvg fallback.
Font and Unicode data licenses are included. Python bindings are not yet added.

The terminal SVG dialect supports rectangles, circles, ellipses, polygons,
transforms, groups, text/spans, colors, styles and bundled font outlines. General
SVG paths, clipping, gradients, masks, filters, strokes, rounded rectangles and
complex text shaping remain incomplete. Drawing budgets bound XML, dimensions,
glyphs and outlines. This private additive package keeps existing imports intact.

The existing renderer/CLI comparisons pass, together with Unicode conformance
vectors and native image/codec checks. Representative dimensions match the SDK;
mean channel differences stay below 3/255, with inspected styles and box borders.
Rasterization is not pixel-identical. Full malformed/getter, general SVG,
cross-platform, aggregate and performance acceptance remain unfinished.

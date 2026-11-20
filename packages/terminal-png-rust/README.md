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
transforms, groups, text/spans, colors, styles and bundled font outlines. Element
opacity composites once, separately from inherited fill opacity. General
SVG paths, clipping, gradients, masks, filters, strokes, rounded rectangles and
complex text shaping remain incomplete. Drawing budgets bound XML, dimensions,
glyphs, outlines and cumulative opacity-layer pixels (64 million). This private additive package keeps existing imports intact.

The existing renderer/CLI comparisons pass, together with Unicode conformance
vectors and native image/codec checks. Representative dimensions match the SDK;
mean channel differences stay below 3/255, with inspected styles and box borders.
Rasterization is not pixel-identical. Full malformed/getter, general SVG,
cross-platform, aggregate and performance acceptance remain unfinished.

Rust callers can also use `png::decode(bytes, limit)` and `jpeg::decode(bytes, limit)`
to obtain owned RGBA pixels and image metadata. The bounded PNG decoder preserves
palette transparency, 16-bit samples and Adam7 interlacing; the JPEG decoder
supports baseline and progressive images. These are the same extracted codecs
used by the shell and the standalone PDF writer.

`png::decode_async`, `jpeg::decode_async` and `png::deflate_async` expose the same
codecs as cooperative futures. Their synchronous counterparts drive those same
implementations. CRC, inflation, filtering, pixel reconstruction and compression
yield in bounded batches, allowing a browser host to cancel between polls.

`office_image::characterize` admits PNG, JPEG, GIF, BMP and TIFF headers for Office embedding and preserves independent horizontal/vertical resolution. It validates the container header without decoding pixels.

`gif::decode_async`, `bmp::decode_async` and `tiff::decode_async` share the shell's
first-party Rust raster decoders with the PDF writer. GIF exports the first
frame on its logical canvas, with unpainted pixels transparent as in browsers;
its animation callback preserves subsequent frame disposal. BMP supports CORE
and Windows RGB/bitfield headers, indexed pixels and bounded RLE8. TIFF exports
the first page and supports chunky bilevel/gray/RGB samples, 8/16-bit channels,
straight/associated alpha, strips/tiles, horizontal prediction, raw, PackBits,
LZW, Deflate, JPEG and CCITT compression. Unsupported BMP color profiles/RLE4
and TIFF palette/CMYK/separate-plane/color-profile encodings fail explicitly.
Truncated pixel data is never replaced with blank pixels. Office embedding
characterizes headers and retains original bytes, including profiles that the
PDF raster decoder does not support; it does not validate compressed payloads.

Independent Pillow/libtiff fixtures test decoded pixels, dimensions, alpha,
compression, memory boundaries and cooperative cancellation. Pandoc is a
comparison, with explicit exceptions where its TeX route crops GIF canvases,
misplaces BMP RLE8 deltas or mishandles associated-alpha/JPEG TIFFs.

# safe-bash-pdf-engine

JavaScript PDF layout and serialization helpers used by spreadsheet conversion
and standalone layout callers. Editor and Safe Bash Pandoc DOCX/PDF writers use
`document-converter-rust` and the Rust document engines.
`renderPdf(document, context)` produces PDF 1.7 bytes from explicit layout blocks
and supplied TrueType or standard PDF fonts. `suppliedDefaultFont()` returns the packaged
JetBrains Mono font; `suppliedSansFont()` returns embedded DejaVu Sans. `pdfCapabilities()` describes the supported profile;
`PdfError` reports capability, budget, and cancellation failures.
`admitTrueTypeFont(bytes, fail, work)` validates sfnt tables, character maps,
outline ranges and metrics before a custom PDF painter parses supplied fonts.
The caller bounds and owns the bytes; `work` can refuse coverage expansion.

## Configuration

`LayoutDocument` requires `fonts` and `blocks`. Each font has an `id` and either
TrueType `bytes` or a standard font name, for example
`{id: "heading", standard: "Helvetica-Bold"}`. Standard fonts need no supplied
font file and use their built-in character coverage.
Optional fields are `page` (`width`, `height`, `margin`, in points), `lineHeight`,
and `metadata` (`title`, `author`, `subject`, `keywords`). The default page is
595.28 × 841.89 points with a 48-point margin; the default line-height multiplier
is 1.2.

Paragraphs contain `kind: "paragraph"` and `runs` (`text`, optional `font`, `size`,
`link`, `bold`, `italic`, `strikeout`, `underline`, `rise` in points, and six-digit RGB `color`/`background`). A run may carry an `anchor` or an inline `image` with the same fields as an image block. Bold and italic use synthetic
weight and oblique styling of the supplied font. Paragraph options are `id` (internal link target), `outline`, `spaceBefore`, `spaceAfter`, `keepWithNext`, `indent`, `align` (`left`, `center`, `right`),
`widows`, `orphans`, and `longWord` (`wrap` or `error`). Images contain
`kind: "image"`, `bytes`, `media` (`png` or `jpeg`), `width`, `height`, and optional
`fit` (`contain` or `natural`). Tables contain `kind: "table"`, `rows`, `widths`,
and optional `headerRows` and `rowSplit` (`error` or `lines`). Cell paragraphs
retain their alignment when wrapping or continuing onto another page.
Horizontal rules contain `kind: "rule"` and optional `indent`. All blocks accept
`breakBefore` and `keepTogether`.

`PdfContext` accepts `signal`, `yield`, `charge`, `onPlacement`, and `limits`.
`onPlacement` receives top-down placement boxes with one-based page numbers.
`charge` permits a host to enforce shared budgets before admitted work.

All resource limits, exported as `defaultPdfLimits`, default to `Infinity`, including `imagePixels` for the total pixels in embedded images.
Supply nonnegative safe integers to opt into finite ceilings; explicit `Infinity`
keeps a resource unbounded. PNG scanlines are checked against their declared
dimensions and the configured image/work budgets.

`limits` overrides individual ceilings. See [the exported model](src/model.ts)
for the layout and callback types. The supported profile includes left-to-right
Latin (including Latin Extended), Greek, and Cyrillic text with punctuation, covered symbols and standalone Emoticons (U+1F600–U+1F64F), static images, and rectangular unspanned tables. Emoticons require supplied font coverage and positive advances; the bundled DejaVu font supplies 63 monochrome outlines. Joiner sequences, variation selectors and emoji modifiers remain unsupported.
Tagged accessibility, PDF/A, encryption, JavaScript, and attachments are unsupported.

## Environment variables

The package exposes no environment variables and never discovers system fonts.
Font and image bytes must be supplied explicitly.

## Development

Run `npm run build --workspace=safe-bash-pdf-engine`,
`npm run typecheck --workspace=safe-bash-pdf-engine`, or
`npm run test:unit --workspace=safe-bash-pdf-engine` from the repository root.

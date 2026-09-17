# @poe-code/pdf

Private PDF-rendering workspace used by the document-conversion engine.
`renderPdf(document, context)` produces PDF 1.7 bytes from explicit layout blocks
and supplied TrueType fonts. `suppliedDefaultFont()` returns the packaged
JetBrains Mono font. `pdfCapabilities()` describes the supported profile;
`PdfError` reports capability, budget, and cancellation failures.

## Configuration

`LayoutDocument` requires `fonts` (`id` and `bytes` for each font) and `blocks`.
Optional fields are `page` (`width`, `height`, `margin`, in points), `lineHeight`,
and `metadata` (`title`, `author`, `subject`, `keywords`). The default page is
595.28 × 841.89 points with a 48-point margin; the default line-height multiplier
is 1.2.

Paragraphs contain `kind: "paragraph"` and `runs` (`text`, optional `font`, `size`,
`link`). Paragraph options are `outline`, `spaceAfter`, `keepWithNext`, `indent`,
`widows`, `orphans`, and `longWord` (`wrap` or `error`). Images contain
`kind: "image"`, `bytes`, `media` (`png` or `jpeg`), `width`, `height`, and optional
`fit` (`contain` or `natural`). Tables contain `kind: "table"`, `rows`, `widths`,
and optional `headerRows` and `rowSplit` (`error` or `lines`). All blocks accept
`breakBefore` and `keepTogether`.

`PdfContext` accepts `signal`, `yield`, `charge`, `onPlacement`, and `limits`.
`onPlacement` receives top-down placement boxes with one-based page numbers.
`charge` permits a host to enforce shared budgets before admitted work.

Default limits, exported as `defaultPdfLimits`, are:

| Limit | Default |
| --- | ---: |
| `fontBytes` | 4,000,000 |
| `fonts` | 8 |
| `glyphs` | 100,000 |
| `pages` | 200 |
| `objects` | 100,000 |
| `images` | 100 |
| `imageBytes` | 8,000,000 |
| `decodedImageBytes` | 32,000,000 |
| `layoutWork` | 500,000 |
| `outputBytes` | 16,000,000 |

`limits` overrides individual ceilings. See [the exported model](src/model.ts)
for the layout and callback types. The supported profile includes left-to-right
Latin, Greek, and Cyrillic text, static images, and rectangular unspanned tables.
Tagged accessibility, PDF/A, encryption, JavaScript, and attachments are unsupported.

## Environment variables

The package exposes no environment variables and never discovers system fonts.
Font and image bytes must be supplied explicitly.

## Development

Run `npm run build --workspace=@poe-code/pdf`,
`npm run typecheck --workspace=@poe-code/pdf`, or
`npm run test:unit --workspace=@poe-code/pdf` from the repository root.

# PDF package README draft — permission gate open

Proposed copy for packages/pdf/README.md; do not apply without explicit permission.
This private workspace is not independently published. No README was changed.

## Private SDK and converter usage

Verified repository workspace API example (not an install recommendation):

```ts
import {renderPdf, suppliedDefaultFont} from "@poe-code/pdf";
const bytes = await renderPdf({fonts: [suppliedDefaultFont()], blocks: [
  {kind: "paragraph", runs: [{text: "Original SDK café Ελληνικά Привет"}]}
]});
```

`qa-typescript/pdf-sdk.json` records the PDF header, byte count, capabilities and
limits for this call. Public converter/CLI examples, format/extension matrix and
all converter options/limits: usage-limitations.md. Public `poe-code/pandoc`
`writeDocument` or `convert` with to pdf invokes this TypeScript engine, including
supplied fonts, page selection and publication options. Native PDF engines,
ambient fonts and native runtime fallback are forbidden. No environment variables.

## All engine configuration

LayoutDocument: fonts (ordered id/owned sfnt bytes), blocks, optional metadata
(title, author, subject, keywords), page (width/height/margin in points), lineHeight
(1..3, default 1.2). Default page A4 595.28×841.89, margin 48.
Paragraph: runs with text/font/size/link, optional outline, spaceAfter, keepWithNext,
indent, widows, orphans, longWord wrap/error, breakBefore and keepTogether.
Image: bytes, png/jpeg media, explicit width/height points, fit contain/natural,
breakBefore, keepTogether. Table: rectangular paragraph cells, positive fractional
widths summing to one, headerRows, rowSplit error/lines, breakBefore, keepTogether.
Leading headers repeat; explicit line splitting can continue rows on another page.
Context: signal, limits, yield, shared charge and onPlacement (one-based page,
kind/x/y/width/height and optional text). suppliedDefaultFont optionally accepts
an admission callback before decoding packaged JetBrains Mono Regular (SIL OFL).

## All default engine budgets

Defaults from the verified built SDK; converter ceilings can further restrict them.
These are bounded trusted primitives, not process memory isolation.

| Limit | Default |
| --- | --- |
| fontBytes | 4,000,000 |
| fonts | 8 |
| glyphs | 100,000 |
| pages | 200 |
| objects | 100,000 |
| images | 100 |
| imageBytes | 8,000,000 |
| decodedImageBytes | 32,000,000 |
| layoutWork | 500,000 |
| outputBytes | 16,000,000 |

PNG additionally caps four million pixels and reserves eight decoded bytes per
pixel. Fonts are explicit sfnt TrueType glyf resources; WOFF/WOFF2/collections
are rejected. Synchronous library font work is not forcibly preemptible.

## Limitations and evidence

Profile PDF-1.7-supplied-fonts-ltr, Adobe PDF Reference sixth edition (November
2006); PDF reference SHA-256 in pdf-reference-pin.md. Latin, Greek and Cyrillic
horizontal LTR only; combining/bidi/complex scripts and missing glyphs reject.
No shaping, full-fidelity typography, encryption, JavaScript, attachments,
tagged-PDF/PDF-UA/PDF-A, guaranteed reading order/searchability/extraction.
Images support static noninterlaced 8-bit PNG and admitted 8-bit JPEG profiles.
Tables must be rectangular/unspanned. URI links are admitted; fragment links
are not document navigation support. Full fonts are embedded, not subsetted.
No PDF reader or PDF editing operation.

Dependencies are declared in packages/pdf/package.json and pinned in root lockfile:
pdf-lib 1.17.1, @pdf-lib/fontkit 1.1.1, pako 3.0.1; transitive graph has additional
versions. These are JavaScript libraries, not native runtime fallbacks.
Current converter acceptance: all five supported pages independently rendered
with PyMuPDF 1.26.4/MuPDF 1.26.7; findings, row continuation, links/image proportions
and rejected multilingual profile are in qa-typescript/results.md.
Office conversion/editing are separate lanes and not PDF capabilities.
Maintained checks: npm run lint --workspace=@poe-code/pdf and
npm run test:unit --workspace=@poe-code/pdf; selected workspace build closure
npm run build:workspaces -- --workspace=@poe-code/pdf.

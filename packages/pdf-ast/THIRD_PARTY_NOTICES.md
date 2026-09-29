# Mozilla PDF.js

The numeric recovery and malformed-command handling in `src/cos/lexer.ts`, and
the regression cases in `src/cos/pdfjs-lexer.test.ts`, are adapted from Mozilla
PDF.js (`src/core/parser.js` and `test/unit/parser_spec.js`), revision
`91041fb94d6744bc2a5bccd9aad28d617faa8195`.

Copyright 2017 Mozilla Foundation. Licensed under the Apache License, Version 2.0;
the full license is in `licenses/PDFJS-APACHE-2.0.txt`.

Adaptations use the local byte-offset/token API, preserve explicit token budgets
and existing exponent support, and translate Jasmine assertions to Vitest. These
files have been modified from the upstream originals.

The content operator vocabulary, known-command token boundaries, and operand
recovery in `src/content/operators.ts`, `src/content/parser.ts`, and
`src/cos/lexer.ts` follow PDF.js `EvaluatorPreprocessor` and `Lexer`. The cases
in `src/content/pdfjs-operators.test.ts` are adapted from
`test/unit/evaluator_spec.js` at the same revision. Nested text assertions use
`BT`/`ET` to expose local text AST nodes; unmatched `Q` is omitted from the local
balanced group representation. Copyright 2017 Mozilla Foundation, Apache-2.0.

The binary-string conversions in `src/bytes.ts` and five utility test cases in
`src/bytes.test.ts` are adapted from `src/shared/util.js` and
`test/unit/util_spec.js` at the same revision (Copyright Mozilla Foundation,
Apache-2.0). Adaptations add TypeScript types, use spread with bounded 8192-byte
chunks, and replace the upstream error helper with Error. Additional tests cover
all byte values, content serialization, and form appearance resource isolation.

Source: https://github.com/mozilla/pdf.js

# qpdf

The fixtures documented in `src/fixtures/SOURCES.md` and the shared-page
selection regression in `src/edit/qpdf-resources.test.ts` come from qpdf revision
`4eba95899886e851cc41d76886483b347612f2a8`. Resource-use analysis also follows
qpdf's `ResourceFinder` and `QPDFPageObjectHelper` behavior.

Copyright (c) 2005-2021 Jay Berkenbilt, 2022-2026 Jay Berkenbilt and Manfred Holger.
Licensed under Apache-2.0; see `licenses/PDFJS-APACHE-2.0.txt`. The tests were
adapted to the local TypeScript API and extended with redaction cases.

Source: https://github.com/qpdf/qpdf


# PDF.js standalone image decoders

`src/vendor/pdfjs-image-decoders.mjs` vendors the official PDF.js 4.1.392
`image_decoders/pdf.image_decoders.mjs` distribution (Mozilla Foundation,
Apache-2.0). This is the last PDF.js release with synchronous JavaScript JPX
and JBIG2 decoders, matching this library's synchronous, portable API.
Local JPX bounds checks reject truncated boxes, markers, tile parts, zero tile
sizes, and zero component subsampling before allocation. A 101-byte JP2 prefix
otherwise exhausts memory in the upstream build. Other adaptations remove the global export
assignment and unavailable source-map reference, add per-instance dimension
callbacks to enforce requested image budgets before pixel/region allocation,
preserve budget errors through JPX recovery, add a generated-code lint
comment, and provide a local TypeScript declaration for the used API.

Source: https://unpkg.com/pdfjs-dist@4.1.392/image_decoders/pdf.image_decoders.mjs
Upstream SHA-256: `257b89097a3266bcae8cd04d6faaec135a0774f6762b4476c44f0c76f8334f49`.
Full license: `licenses/PDFJS-APACHE-2.0.txt`.
Fixture provenance and independent reference pixels are documented in
`src/fixtures/SOURCES.md`.

# PDF.js font parsing, metrics, and path compilation

`src/vendor/pdfjs-fonts.mjs` bundles PDF.js CFF parsing/compilation, Type 2 path
compilation, encodings, Adobe glyph names, and standard-font metrics from revision
`91041fb94d6744bc2a5bccd9aad28d617faa8195` (Mozilla Foundation, Apache-2.0).
The only source adaptation exports the internal `Type2Compiled` class; local
code converts its path commands to PDF AST segments without evaluating generated
JavaScript. `src/fonts/pdfjs-cff.test.ts` ports eight cases from
`test/unit/cff_parser_spec.js` to Vitest, retaining the Adobe CFF specification
example bytes and the upstream expectations. The JavaScript bundle can be
regenerated with `scripts/vendor-pdfjs-fonts.mjs <PDF.js checkout>`.

# PDFium/Foxit standard fonts

`src/fonts/standard-font-data.ts` contains base64-encoded, unmodified CFF font
programs. Serif, fixed-width, Symbol, and Dingbats faces are the `Foxit*.pfb`
files from the same PDF.js revision's `external/standard_fonts` directory.
Despite their extension these are CFF programs, not Type 1 PFB containers.
Sans faces are the byte arrays in `FoxitSans{,Bold,Italic,BoldItalic}.cpp` from
PDFium revision `a84323421e94f484faca52dd9d027934eba42ab8`, directory
`core/fxge/fontdata/chromefontdata`.

Copyright 2014 The PDFium Authors. Original code copyright 2014 Foxit Software
Inc. Licensed under the BSD terms in `licenses/PDFIUM-BSD.txt`.
Sources: https://github.com/chromium/pdfium/tree/a84323421e94f484faca52dd9d027934eba42ab8/core/fxge/fontdata/chromefontdata
and https://github.com/mozilla/pdf.js/tree/91041fb94d6744bc2a5bccd9aad28d617faa8195/external/standard_fonts

Regenerate the portable font-data module using
`scripts/generate-standard-font-data.mjs <PDF.js checkout> <directory containing FoxitSans*.cpp>`.
No Liberation font files are included.

# PDF.js JPEG decoding

`src/extract/images.ts` uses the `JpegImage` export of the standalone decoder
bundle above, replacing the local handwritten JPEG codec. PDF `/Decode` and
`/ColorTransform` handling follows PDF.js v4.1.392 `src/core/jpeg_stream.js`.
The vendored decoder accepts an optional dimension callback before allocating
frame components, preserving caller-specified byte budgets.
`src/extract/jpeg-reference.test.ts` ports the CMYK image shape expectation from
`test/unit/api_spec.js` (issue 4888) and the baseline/extended/progressive SOF
header cases from `test/unit/jpeg_stream_spec.js` at revision
`91041fb94d6744bc2a5bccd9aad28d617faa8195`. The SOF cases assert local byte-budget
behavior instead of browser ImageDecoder availability. Independent pixel
oracles extend those upstream checks; provenance is in `src/fixtures/SOURCES.md`.
Mozilla Foundation, Apache-2.0; see `licenses/PDFJS-APACHE-2.0.txt`.

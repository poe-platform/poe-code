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

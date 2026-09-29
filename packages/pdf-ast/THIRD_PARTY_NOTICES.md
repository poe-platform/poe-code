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

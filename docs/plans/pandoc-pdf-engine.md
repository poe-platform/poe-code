# PDF engine implementation

Scope: private @poe-code/pdf byte/capability API, independent layout model, built-in Pandoc writer; existing safe-bash adapter remains thin. No native/WASM runtime.

Reference: Adobe PDF Reference, sixth edition, version 1.7 (November 2006). Profile: PDF 1.7, embedded caller-supplied TrueType/OpenType fonts, no encryption, JavaScript or attachments. A4, 48-point margins by default; explicit point-based page geometry. Horizontal left-to-right Latin, Greek and Cyrillic only; reject unsupported shaping rather than silently rendering wrong glyphs. Ordered supplied font fallback, no ambient font discovery.

Evaluate pdf-lib 1.17.1 (MIT, TypeScript PDF object serialization, PNG/JPEG embedding) and @pdf-lib/fontkit 1.1.1 (MIT, JS font parsing/shaping). Selected as bounded byte primitives; engine owns wrapping, blocks, table rows, links, page placement and accounting. PDFKit 0.17.2 is JS but has Node stream/host-oriented API; reject for this capability surface. HarfBuzz WASM, native TeX, Chromium and native Pandoc rejected: compiler/runtime substitutes violate task. Exact installed transitive graph belongs to package-lock.json. Libraries do not provide this output profile or layout budget guarantees on their own.

1. Write original failing public API tests (bytes/profile, pagination, fonts, links/tables/images, limits and cancellation).
2. Implement independent engine and verify maintained workspace tests/lint/build.
3. Write failing Pandoc API/adapter tests, wire engine, verify scope and commit.
4. Record evidence and pending README copy under docs/pandoc; do not modify READMEs without permission.

QA procedure: generate representative output using supplied fonts, inspect page geometry/text/embedded font and links via independent PDF parsing in tests. Visual inspection of a rendered representative document is required for visual output claims; record any unavailable validation honestly. No external executable or host mutation in unit tests.

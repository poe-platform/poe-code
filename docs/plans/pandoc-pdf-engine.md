# PDF engine implementation

Scope: private @poe-code/pdf byte/capability API, independent layout model, built-in Pandoc writer; existing safe-bash adapter remains thin. No native/WASM runtime.

Reference: Adobe PDF Reference, sixth edition, version 1.7 (November 2006). Profile: PDF 1.7, embedded caller-supplied TrueType/OpenType fonts, no encryption, JavaScript or attachments. A4, 48-point margins by default; explicit point-based page geometry. Horizontal left-to-right Latin, Greek and Cyrillic only; reject unsupported shaping rather than silently rendering wrong glyphs. Ordered supplied font fallback, no ambient font discovery.

Evaluate pdf-lib 1.17.1 (MIT, TypeScript PDF object serialization, PNG/JPEG embedding) and @pdf-lib/fontkit 1.1.1 (MIT, JS font parsing/shaping). Selected as bounded byte primitives; engine owns wrapping, blocks, table rows, links, page placement and accounting. PDFKit 0.17.2 is JS but has Node stream/host-oriented API; reject for this capability surface. HarfBuzz WASM, native TeX, Chromium and native Pandoc rejected: compiler/runtime substitutes violate task. Exact installed transitive graph belongs to package-lock.json. Libraries do not provide this output profile or layout budget guarantees on their own.

1. Write original failing public API tests (bytes/profile, pagination, fonts, links/tables/images, limits and cancellation).
2. Implement independent engine and verify maintained workspace tests/lint/build.
3. Write failing Pandoc API/adapter tests, wire engine, verify scope and commit.
4. Record evidence and pending README copy under docs/pandoc; do not modify READMEs without permission.

QA procedure: generate representative output using supplied fonts, inspect page geometry/text/embedded font and links via independent PDF parsing in tests. Visual inspection of a rendered representative document is required for visual output claims; record any unavailable validation honestly. No external executable or host mutation in unit tests.

## Status

- Engine delivered in local commit 4760f1e32, with original failing public-API tests before implementation.
- Built-in Pandoc writer added after three failing public conversion/adapter tests. All 892 Pandoc tests and six engine tests pass. Workspace build closure and scoped lint/typechecks pass (final rerun status in evidence).
- Original in-memory PNG coverage added; no downloads or filesystem mutations in tests. Packaged font decoding gains admission hook, validated with a failing test before implementation.
- Full test route exposed missing generated SafeJS/package-lint/root artifacts and missing root workspace registrations. Root registrations for these two packages repaired; completeness test now passes. No unrelated source changed.
- Quick Look first-page PNG generated from representative PDF and visually inspected: heading, Latin/Greek/Cyrillic, links, tables and page margins readable. Pagination separately parsed in engine tests.
- README copy remains pending as instructed. No push or release authorized.

PDF option follow-up: removed the placeholder `pdf` writer option, which has no SDK/CLI implementation. Original public registry test accepted it before the fix and now rejects it with E_OPTION. Only standalone is advertised.

Final scope verification: eight PDF tests, 893 Pandoc tests, both maintained package lint/typecheck routes and the selected build closure pass. Normal workspace/root build, repository ESLint, root type contracts and workflow lint passed. Full test retry was stopped after a validated unrelated missing archive fixture; full-suite completion remains unverified. Package README installation is intentionally pending; code/adapter implementation is delivered locally only.

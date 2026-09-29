# PDF AST correctness and stress qualification

User objective: bring pdf-ast to perfection and work for ten hours, stress testing throughout. This is an ongoing correctness campaign, not a claim that passing a finite suite proves perfection.

Work began at 2026-09-29 02:42 UTC. The requested ten-hour minimum ends at 2026-09-29 12:42 UTC. Continue beyond that minimum if required work remains. Use actual execution evidence, not elapsed time alone, for completion.

## Required outcomes

- Redaction removes targeted content from saved objects and prior revisions while preserving unrelated content and shared resources correctly (#4093).
- Bitmap and SVG output preserve PDF painting order across text, images, paths, nested forms, and transparency (#4094).
- JBIG2 and JPEG 2000 support uses real decoding and independent fixtures with reference pixels (#4095).
- Validate parser/writer round trips, malformed inputs, xref/object streams, encryption, resource budgets, forms, fonts, text/table extraction, and rendering against independently produced PDFs.
- Compare real rendered pages with Poppler and inspect PNG evidence. Record meaningful unsupported behavior and fix validated failures; never count fabricated output or unavailable cases as successful support.
- Keep regression tests fast, deterministic, in memory, and independent of implementation assumptions. Execute stress/visual QA as an agent following this document; store transient corpus, logs, and renderings in /out and remove them after use.
- Preserve portable TypeScript operation and existing public API compatibility where possible. Maintain honest feature documentation.
- Deliver each atomic fix separately to remote main after appropriate lint/tests, close only fully resolved issues, and monitor publication to success.

## Execution log

- Initial audit: existing 87 tests passed; independently reproduced retained redacted text and incorrect image/path paint order; source inspection confirmed placeholder JBIG2/JPX decoding.
- Started #4093 with saved-object regression coverage. Other checkout changes are outside this work and remain untouched.
- User direction: use an established PDF library as the reference and port upstream unit tests. Primary reference is Mozilla PDF.js, pinned initially at `91041fb94d6744bc2a5bccd9aad28d617faa8195`. Preserve Apache-2.0 notices and provenance for ported cases. Consult independent editing engines for behavioral comparisons without importing incompatibly licensed code.
- `/out` is read-only on this host; use the repository's ignored `out/pdf-ast-quality-20260929/` for transient evidence and reference checkouts.
- #4093: ten regressions failed before implementation and now pass; complete package suite passes 97 tests. Package lint/typecheck passes (six existing unused-symbol warnings), maintained workspace build succeeds, and 35 PDFtk integration tests pass. An independently generated ReportLab/pypdf content-array PDF was redacted and saved with incremental requested: pypdf strict parsing confirms preserved public text, no secret in any output stream, and no `/Prev`. Poppler rendered it and the PNG was visually inspected successfully.
- First redaction fix is verified on remote main at `9ec019fc96`; Release run `36514780067` was queued. Further qualification reproduces a retained image via inherited `/Pages/Resources`, so #4093 remains open for follow-up.
- #4094 and #4095 were reserved by the existing hey-boss fleet on Mac.lan. Added the user's PDF.js direction and full acceptance scope to their issue comments; did not start competing implementations.
- #4101: ported 33 PDF.js lexer cases with attribution (18 failed initially), plus 11 local boundary/progress/end-offset regressions. All 141 package tests pass after adapting numeric recovery and command boundaries. Differential testing against the actual pinned PDF.js Lexer matched values and consumed offsets for 25,000 deterministic numeric cases. Exhaustively tested all 65,536 two-byte inputs for forward progress, including error recovery; none hung.

## Completion evidence to collect

For each outcome record the tested revision, focused and integration commands/results, corpus provenance, independent comparison method, examined visual outputs, issue status, remote-main commit, and release publication. Require at least ten hours of work plus verified completion of all outcomes before marking the goal complete.

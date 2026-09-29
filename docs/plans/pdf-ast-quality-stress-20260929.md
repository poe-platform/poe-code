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
- #4101 delivered and verified at remote-main commit `cffdca988e`; issue closed. Release `36515469796` completed successfully but skipped publication because it was superseded. Its ancestor release `36514780067` was superseded/cancelled; publication remains unproven.
- #4094 reservation expired without an active claim; now claimed locally for ordered-painting implementation after the inheritance follow-up. #4104 records visually confirmed standard-font fallback defects (crude uppercase stroke shapes instead of mixed-case Helvetica).
- #4093 follow-up: preserve inherited MediaBox/CropBox/Rotate/Resources before flattening page parents; remove obsolete inherited resource roots; trace actual XObject use through Forms, patterns, fonts, masks, and annotation appearances before garbage collection. Regressions include unused shared resources on another page. qpdf reference revision is `4eba95899886e851cc41d76886483b347612f2a8`; two small unmodified fixtures are retained with provenance and licensing.
- Independent qpdf fixture qualification: pypdf confirms redacting page one of the ten-page shared-image fixture leaves resource counts `[0,1,1,1,1,1,1,1,1,1]` and nine image objects. PyMuPDF confirms six image placements in the Forms-without-Resources fixture. Poppler renders byte-identical RGB pixels before/after cleanup at a 900-pixel long edge; final PNG visually inspected.

- Inheritance/resource follow-up verification: 150 package tests passed; package lint/typecheck and maintained build passed; PDFtk, qpdf, pdfinfo, and pdftotext consumer suites passed. Publication tracking continues through descendant release runs.

- #4093 inheritance/resource fix verified on remote main at `d0e78ba204`; issue closed. Descendant release runs remain pending; no publication claimed.
- #4094: eight initial failures reproduced, then fixed by emitting an ordered paint operation list (following PDF.js operator-list design) while retaining extraction arrays. Fourteen focused tests cover every image/path/text permutation, nested Forms, tiling patterns, shading, inline images, Type 3 glyphs, annotation appearances, alpha blending, and legacy display lists. An independent ReportLab six-panel PDF visually matches Poppler painting order; all four fully occluded panel interiors match exactly. Visible text retains the separately tracked #4104 font-outline difference.

- #4094 delivered to remote main at `9bd4c808f2`; issue closed. Its release run `36516905650` was cancelled/superseded; publication remains tracked via descendant runs.
- #4111: ported 14 PDF.js evaluator/operator tests, 13 failing initially. Adopted its command vocabulary, reserved prefixes, argument-count recovery, and malformed-path rejection. All 178 package tests and lint/typecheck pass. Exhaustive comparison of all 6,889 concatenated vocabulary pairs matches actual PDF.js token values and consumed offsets, zero skipped cases. A recovered glued-operator sample renders pixel-identically to Poppler's equivalent spaced-operator PDF; Poppler itself rejects the glued malformed syntax. PNG visually inspected. Isolated consumer tests initially lacked built safe-bash-contracts; built the maintained qpdf dependency closure and reran successfully: 31 qpdf, 18 pdfinfo, 22 pdftotext tests. PDFtk (35) and pdftoppm (21) also pass.
- Work now continues in the isolated `out/pdf-ast-quality-20260929/delivery` checkout to prevent concurrent main rebases from briefly removing sources during test execution. Original checkout has no outstanding pdf-ast edits from this session.

- #4111 operator recovery delivered to remote main at `bff09193bd`; issue closed. Publication is still pending in the release queue.
- #4095: replaced fabricated JBIG2/JPX pixels with the official PDF.js 4.1.392 standalone JavaScript decoder bundle (the final synchronous JS JPX release). Preserved license/provenance; removed only the global export and missing source-map reference initially. Added real independent jbig2enc/OpenJPEG/libtiff fixtures and two PDF.js regression PDFs. Twelve initial codec tests all failed before replacement; 22 codec tests now cover pixels, shared globals/filter arrays, MMR/arithmetic coding, raw/tiled JP2/J2K, grayscale, inferred dimensions, and invalid input.
- #4095 stress found a real upstream decoder flaw: JP2 truncated at byte 101 consumed memory until a 64 MB subprocess aborted. Added local JPX box/marker/tile bounds checks and invalid-size/subsampling guards with regression tests. All 483 JP2/J2K prefixes now terminate: 481 rejected, two raw J2K prefixes missing the EOC bytes recover exact original pixels. All 100 independently encoded RGB/gray JP2/J2K images (including tiles and reversible color transforms) still match reference pixels exactly.
- Both upstream codec regression images match independent PyMuPDF RGBA hashes and were visually inspected side by side. The shared-symbol fixture uses lossy jbig2enc mode; its separate expected hash matches PyMuPDF, whereas arithmetic/MMR fixtures match the original bi-level source. Final package suite: 200 tests passed, lint/typecheck and maintained build passed. No native runtime dependencies were added; jbig2enc was installed only as an independent fixture generator.

## Completion evidence to collect

For each outcome record the tested revision, focused and integration commands/results, corpus provenance, independent comparison method, examined visual outputs, issue status, remote-main commit, and release publication. Require at least ten hours of work plus verified completion of all outcomes before marking the goal complete.

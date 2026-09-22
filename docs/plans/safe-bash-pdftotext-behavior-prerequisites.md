# pdftotext behavior prerequisite review

Inspected 2026-09-21 for `behavior-pdftotext`. Behavior implementation remains incomplete. This review records current source evidence, not executed Poppler controls or passing compatibility cells.

## Verified blocker

The `engine-pdftotext` plan entry is marked `implement: done`, but its [handoff](safe-bash-pdftotext-engine-prerequisites.md) explicitly says no engine was implemented. Current inspection confirms there is no `packages/safe-bash-command-pdftotext` directory and no pdftotext dependency or export in `packages/safe-bash/package.json`. Searches of package TypeScript source, excluding tests, dependencies and generated dist, found no extraction implementation for `ActualText`, `parsePdf`, `parsePDF`, `PDFParser`, `ParsedGlyph` or `GlyphRun`; the only `ToUnicode` match concerns IDNA in safe-python.

The [shared PDF parser plan](safe-bash-pdf-parser.md) still leaves byte syntax, revisions, filters, page trees, security, font/content interpretation, extraction layout and parser API implementation open. The [command plan](safe-bash-pdftotext.md) requires accepted parser glyph/run/coordinate APIs and states: “prerequisite plans must pass their stated acceptance gates before dependent integration.” A completed evidence task does not establish those gates.

`packages/pdf/src/index.ts` exports document generation through `renderPdf`, not existing-document extraction. Its manifest depends on `pdf-lib`, `@pdf-lib/fontkit` and `pako`; it cannot supply the requested dependency-free extraction boundary. The requested package-pattern document has been moved in unrelated edits; its [archived copy](archive/safe-bash-command-package-pattern.md) was inspected without restoring or modifying it. That pattern prohibits empty scaffolds and assigns shared PDF parsing to a responsible engine package.

## Behavior cells still open

| Requested behavior | Missing accepted input or execution contract |
| --- | --- |
| Page ranges and image-only pages | Parsed page count/tree, admitted page geometry and content interpretation distinguishing absence of text from unsupported mappings |
| Crop/slice and bbox geometry | Source glyph extents, rotation, font metrics, resolution transforms and mode-specific page/crop geometry |
| XML escaping and bbox/layout serialization | Accepted words/lines/blocks/flows and metadata decoding provenance; independent complete serializer goldens remain unavailable |
| Encodings, EOL and page breaks | Extraction engine producing logical/raw/physical events and admitted output maps that encode whitespace and formfeed as well as glyph text |
| Unsupported glyph diagnostics | Source-byte/code/CID/glyph and mapping provenance, with explicit strict/recovery profiles |
| Named VFS publication | Real invocation lifecycle, byte streams, alias identity and conditional-write policy connected to extraction; branch-specific named-output effect controls remain open |
| Passwords and copy permissions | Accepted security API and one explicit compatibility permission profile shared by CLI and SDK |
| Installed public API | Real private command implementation, maintained build/export integration and isolated runtime/declaration consumers |

The [acceptance matrix](safe-bash-pdftotext-acceptance.md) remains open in full. Supplied native observations are reference evidence; original fixture bytes and complete per-cell receipts are unavailable locally. No substring extractor, OCR substitute, fabricated glyphs, host process or external parser was introduced.

## Required next increment

Complete and accept the shared parser gates and real extraction engine before dependent behavior integration. Then begin with failing memory-VFS edge tests for page normalization/reversal, mode-specific clipping, six-decimal bbox geometry and all XML metacharacters, encoding of space/EOL/final and blank-page formfeed, unresolved mappings, alias/conditional-write rejection and cancellation during publication. Exercise the same contracts through CLI and SDK.

Each increment must charge input reads/copies, decoded bytes, retained glyph/layout structures, encoded output and algorithm work before allocation or execution, with bounded parser recursion and marked-content scopes. Verify release of retained reservations, stream cancellation and invocation cleanup on success, diagnostics, sink failure and arbitrary thrown values. These are future acceptance requirements, not current implementation claims.

Only this review document was added. No runtime code, tests, manifests, existing plans or unrelated edits were changed. No tests, screenshots, package build, commit, push, publication or release was performed; none would establish absent parser/engine acceptance.

# pdftotext engine prerequisite evidence

Inspection date: 2026-09-21. Task: `engine-pdftotext`. Implementation is blocked by absent accepted PDF parser font/content, extraction-layout and security APIs.

## Verified source findings

| Required prerequisite | Inspected source | Result |
| --- | --- | --- |
| Font/content interpretation | `safe-bash-pdf-parser.md`, tasks `pdf-font-text` and `pdf-parser-api`; package TypeScript source inventory | Both tasks have `implement: open`. No extraction parser package or parsed glyph/run API was found. Searches for `ActualText`, `ToUnicode`, `GlyphRun`, `ParsedGlyph`, `parsePdf`, `parsePDF` and `PDFParser` outside tests and generated artifacts found no PDF extraction implementation. |
| Reading-order and physical layout | `safe-bash-pdf-parser.md`, task `pdf-extraction-layout`; `packages/pdf/src/model.ts` | Extraction-layout task is open. Existing `TextRun` and `Placement` describe generated content, not parsed source glyphs, mapping provenance, ActualText extents or qualified logical flows. |
| Applicable security gate | `safe-bash-pdf-parser.md`, task `pdf-security` | Implementation is open. No accepted password/copy-permission extraction contract was found. |
| Existing PDF engine suitability | `packages/pdf/src/index.ts:21`, `packages/pdf/package.json` | `renderPdf` generates documents; it is not an existing-document extraction API. Its runtime dependencies include `pdf-lib`, `@pdf-lib/fontkit` and `pako`, so it does not satisfy the requested first-party runtime boundary. |
| Command and public integration | Parsed `packages/safe-bash/package.json`; package source inventory | No `safe-bash-command-pdftotext` workspace, dependency or `./commands/pdftotext` export exists. |
| Package pattern | `archive/safe-bash-command-package-pattern.md` | Requested original plan path is absent in unrelated edits. Archived copy was read without restoring that path. It requires real command implementations, prohibits empty scaffolds, and assigns shared parsing to narrowly scoped private engines. |

These are source inspection findings, not failing engine tests or executed native controls. Supplied pinned Poppler observations remain reference evidence. The existing [acceptance matrix](safe-bash-pdftotext-acceptance.md) also records unavailable original fixture bytes and per-cell receipts; no native or first-party compatibility cell was newly qualified.

## Required handoff before implementation

Accept the shared parser's source bytes/code/CID/glyph and mapped-Unicode provenance, bounded ActualText scope interpretation, coordinates and page geometry, rotation, writing direction, font metrics, diagnostics and qualified layout APIs. Qualify applicable security, cancellation, resource accounting and invocation ownership before dependent extraction. Select one explicit permission profile shared by CLI and SDK; native default and `ENFORCE_PERMISSIONS` are separate profiles.

Then write fast original failing engine tests using the accepted interfaces and memory VFS. Cover separate logical flows, physical fragments and content-order glyph paths; ToUnicode multi-scalar/surrogate destinations, literal ligatures, glyph-name mapping distinctions, ActualText replacement/nesting/recovery, TJ geometry, rotation, vertical writing and RTL through explicit capability tests. Preserve unresolved mapping provenance and reject unqualified features rather than inventing Unicode or flattening all modes to one string.

Test encoded whitespace/EOL/formfeed, final and blank-page formfeeds, logical-only dehyphenation, limits before allocation, cancellation during read/layout/write, cleanup on every exit and thrown value, backpressure, realm ownership and replay invariants. Admission tests must separately cover exact options, positional unknown tokens, `--`, repeated values, checked finite numerics and positive DPI, CLI truncation versus SDK raw passwords, early validations and format precedence from the researched specification.

Implement in private ESM `packages/safe-bash-command-pdftotext`, consuming shared APIs with no external runtime dependencies. Safe Bash only composes and exports it. Verify bundled runtime/declarations through maintained build and isolated installed `@poe-platform/safe-bash/commands/pdftotext` consumers with no unpublished package present. Do not publish the command workspace.

Only this evidence document was added. No runtime code, tests, manifests or existing plans were changed. No build, screenshot, commit, push or release was performed. Engine implementation remains incomplete; a missing-module test or invented parser interface would not establish the requested prerequisite acceptance.

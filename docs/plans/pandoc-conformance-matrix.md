# Pandoc conformance matrix execution

## Procedure

1. Read the root/scoped instructions, contract and inventory. Preserve unrelated edits.
2. Bind research to source commit `c9a9a5eed7185783b69043e019c067370dc09615`.
   Identify the executable oracle independently; historical Pandoc 3.10.1 is
   not evidence of a build from that commit. Never execute upstream command fences.
3. Execute owned representable reader/writer cases, including aliases, EPUB2/3
   inputs, EPUB3 output and PDF from every reader. Assert independent AST,
   structural and selected literal-byte expectations. Use memfs for mutations.
4. Exercise command stdout, stderr, status, failed-publication effects,
   unsupported features, capability denial and unknown options.
5. Reproduce each mismatch with an original failing unit test before fixing it.
6. Run maintained package tests/lint/build and standards lanes. Record exact
   denominators, evidence and unavailable oracle lanes under docs/pandoc.
7. Independently validate EPUB container/OPF/XHTML/navigation and PDF parsing,
   text/pages. Pin external rendering tools separately; missing renderers leave
   rendered comparisons not-run. Native JSON differential rows remain not-run
   without an executable; do not substitute round trips.
8. Commit verified atomic changes on main using explicit owned paths. No push.

## Status

- Initial environment: no `pandoc`, `pdfinfo`, `pdftoppm` or `epubcheck` on PATH.
- Upstream inventory: 4,211 rows; execution accounting will be separate from
  research dispositions. No inventory row is closed by a smoke conversion.
- Initial owned probe: CSV/TSV tables cannot be represented by CommonMark and
  fail with `E_CAPABILITY`; supported prose writers serialize successfully.
- The SDK command adapter returns status 2 for every typed error, conflicting
  with the contract status table. Reproduce with failing tests before changing.
- Status improvement verified: original four-case regression was 1 pass/3 fail
  before implementation. After mapping typed errors to contract statuses,
  maintained package tests pass 960/960; package lint/typecheck and selected
  workspace build pass. Existing typed diagnostics and memfs destination
  preservation remain asserted. No push is authorized.
- Markdown feature classification: three valid original tests failed with
  `E_CAPABILITY` before implementation. Attributed content, unavailable pipe
  tables and flattened line boundaries now use `E_UNSUPPORTED_FEATURE`.
  Maintained package tests pass 963/963, lint/typecheck and build pass.
- Initial owned matrix executed 156 SDK pairs and 156 safe-bash commands.
  Independent output checks pass 46/46 (24 EPUB, 12 PDF, 10 PPTX); both owned
  EPUB input profiles validate. Initial native comparisons include genuine
  provenance differences and an internal-enum versus JSON representation
  comparison that must be corrected in the comparison lane, not in the reader.
- Pinned integration tools are isolated under docs/pandoc/matrix-oracle-tools:
  official Pandoc 3.10.1 release, pypdf 6.0.0, PyMuPDF 1.26.4/MuPDF 1.26.7,
  docutils 0.21.2. Tool files will be removed after execution; evidence remains.

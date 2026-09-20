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
- LaTeX terminal formatting: two original tests failed before implementation.
  Final serialization now ends with one LF while preserving internal paragraph
  separators and code-line representation. Package tests pass 965/965 and
  lint/typecheck pass; selected build is recorded with this improvement.
- Publication feature classification: five original tests failed before
  implementation. LaTeX/RST/RTF writer feature failures, JSON document-field
  projection and the PPTX unsupported-block branch now report
  `E_UNSUPPORTED_FEATURE`; actual PPTX dependency/geometry gates are unchanged.
  Maintained package tests pass 970/970, lint/typechecks/build pass.

## Executed manual QA details

- Verify the clone HEAD and all inventory source size/SHA bindings. Research
  Markdown fences remain data, never executable instructions.
- Use the official ARM64 macOS Pandoc 3.10.1 release artifact, with version,
  executable/artifact SHA-256 and complete help/input/output lists captured.
  Invoke the oracle with literal argv `--sandbox --from FORMAT --to json
  --wrap=none`. For literal code tabs, separately validate `--preserve-tabs`;
  retain the original default difference rather than changing input bytes.
- Author prose `Matrix` in each enabled text reader syntax; CSV/TSV produce a
  one-cell header table. Independently author EPUB2 OPF/NCX and EPUB3 OPF/nav
  ZIPs with one Matrix XHTML chapter. Native Pandoc authors an owned Matrix
  PPTX input using literal argv. These are integration inputs, never downloaded
  unit fixtures or product fallbacks.
- Execute each input profile against all 13 listed writer names/aliases.
  Assert selected exact text expectations, typed failures and ordered warnings.
  Enumerate names from the current registry and assert input inventory coverage.
  The initial capture and subsequent expectation corrections remain separate.
- Execute the real safe-bash adapter over its existing memfs fixture. Check
  empty file-output stdout, exact stderr, status and destination bytes. Failed
  strict conversions must preserve `Keep`. Independently invoke literal command
  argv for unknown-option and unavailable-capability cases before I/O.
- Parse emitted EPUB ZIPs with Python zipfile and XML with ElementTree, not
  the product archive/XML readers. Check CRC, first stored mimetype, container,
  OPF metadata/manifest/spine, XHTML namespaces/body and nav target/fragment
  closure. Check EPUB2 NCX UID, labels, unique IDs and navigation order.
- Parse every generated PDF with pypdf 6.0.0 and MuPDF 1.26.7 through
  PyMuPDF 1.26.4. Check exact Matrix text, one page and in-page word geometry.
  Render all 12 outputs and visually compare labelled crops to the owned
  prose/table expectations; inspect the full CSV table page. Do not compare
  cross-engine PDF bytes. This is single-page QA, not full layout certification.
- Parse PPTX ZIP/content-types/slide text independently. Bind final output
  hashes to the independently validated artifacts before reusing validation.
- Capture the actual adapter's error output screenshot and inspect status 5,
  status 2, status 3 and preserved destinations. This adapter is not a root
  poe-code CLI subcommand; use the maintained generic screenshot route.
- Execute CommonMark's maintained 652-example conformance route, the maintained
  original RST/docutils route and the existing two safe-bash Pandoc test files.
- Retain explicit lossy cases and empty CSV/TSV representable cases as additional
  rows; never replace the 21 strict unsupported rows with these successes.
- Record declared gated DOCX/XLSX-to-PDF rows as not-run content conversions,
  separately from successful capability denials. Keep all 4,211 original local
  inventory IDs pending without claiming a mapping from these smoke cases.
- Remove the isolated downloaded executable and Python tools after recording
  bindings; keep owned inputs, output artifacts, screenshots and evidence.

## Final status

The selected matrix is executed; whole inventory/contract conformance is
incomplete. See docs/pandoc/matrix-summary.md for denominators and differences.
Four verified implementation improvements are committed locally on main.
No push or release is authorized or performed.

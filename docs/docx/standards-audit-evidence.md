# DOCX standards audit evidence

Status: Research and documentation checks passed; no product implementation claim.

Date: 2026-09-13. Inspected main: `dbf33f6554bbd31fe7f696b35cc51910fdfcf198`.
Task: `pin-ooxml-standards` only. Procedure and original future acceptance designs:
[task plan](../plans/docx-standards-audit.md).

## Before-edit observations

- `docs/docx/standards-coverage.md` did not exist.
- `docs/specs/docx.md` required pinning MS-DOCX during implementation and supplied
  no actual revision. MS-ODRAWXML had no baseline row.
- The spec's blanket 96-DPI sentence conflicted with the mirrored native image API's
  embedded-DPI/72 fallback. The pinned API source confirms that behavior in
  `src/docx/document.py` lines 128–135 and `src/docx/image/image.py` lines 86–100,
  116–160. This is documentation evidence, not a product test failure.
- The pinned guide uses comment `id`/`date` at lines 99/105, while source properties
  at lines 130/158 are `comment_id`/`timestamp`. The existing API audit already flags
  this mismatch. The format spec now makes the resolved names explicit.
- The API inventory contains 331 candidate records, 39 source documentation files,
  12 guide topics and zero unresolved-symbol entries. It explicitly disclaims complete
  inherited/prose/protocol/alias closure. This audit retains that disclaimer.
- Unrelated changes existed in `docs/plans/docx-typescript-safe-bash.md`,
  `docs/plans/pyodide-safe-bash.md` and its archive destination. These remain unowned.

## Source verification

Six primary downloads succeeded. The four ECMA archives contain the requested edition
PDFs; P1/P4 cover dates differ from their publisher archive labels as recorded in
[the manifest](standards-sources.json). MS-DOCX displays v20260818/revision 23.0 and
MS-ODRAWXML v20260217/revision 34.0. No fallback edition was substituted.

PDF text extraction completed with Poppler. One `Can't get Fields array` warning was
emitted; inspected clause headings/content and schema declarations were available.
This was text/standards inspection, not visual document-layout QA.

The accompanying Strict, Transitional and OPC schema archives contain 51 XSD files.
All were parsed to record their namespaces and hashes. Crosschecking named declarations
identified that `CT_TxbxContent` is in Transitional WML, while the Strict drawing schema
has its own textbox types. The register uses explicit `wT` for that declaration.
All 147 final ECMA family/type references resolve to actual publisher declarations.
Ten Microsoft extension declarations were checked against the pinned documents' XML
schema text. Their namespaces and §5 locations are separately recorded.

The audit inspected actual section content for package naming/relationships/ZIP,
WordprocessingML structure/formatting/annotations/fields, DrawingML, OMML, MCE and VML.
P3 §9's processed view loses unselected branches: the retention/edit representation
must remain separate. P2 §6.5.3.1 applies an OPC-specific MCE profile and prohibits
`xml:base` in processed relationship XML. The matrix records interleaving, legacy forms,
complex revisions, rendering, codecs, extension semantics and signature cryptography
as unsupported subfeatures rather than claiming exhaustive standards compliance.

## Validation results

- `python3 /Users/kjopek/.codex/skills/write-spec/scripts/check_spec.py docs/specs/docx.md`:
  passed, zero warnings.
- `npx prettier --check docs/docx/standards-coverage.md docs/docx/standards-sources.json docs/docx/standards-audit-evidence.md docs/specs/docx.md docs/plans/docx-standards-audit.md`:
  passed using the repository's maintained formatter and configuration.
- `git diff --check -- <the same five owned paths>`: passed.
- Independent document census: exactly F01–F50 in spec order, every disposition populated,
  50 original T01–T50 case anchors plus J01, and all owned-document relative links resolve.
- Six downloaded byte lengths/SHA-256 values, 51 schema hashes/namespaces and 147 named
  declarations rechecked successfully. Ten extension types were located inside their
  full §5 schema sections, not merely matched in explanatory prose.
- Recorded 86 actual ECMA section heading/PDF-page locators in the manifest.
  Original PDF pages are one-based; printed document pagination can differ.
- Proposed/Not applicable specification metadata preserved. The pinned API checkout
  still reports `e45454602b53e8e572b179ccf1c91093ec9f4ed7`; drift witness files have hashes.
- Product/unit/type/workflow tests and CLI screenshots: not applicable to these
  documentation changes. Future product cases remain unrun, not skipped passes.

## Product and delivery status

No product code or README changed. No unit test was fabricated for this documentation
task; failing-tests-before-code remains required before later implementation.
The original cases T01–T50 and J01 are planned and unrun. No behavioral adaptation,
whole-public-API parity, corpus edit/round-trip, renderer check or implementation
conformance is established. Downloads remain disposable research material outside Git.
No push or release is authorized or attempted. The owned atomic documentation commit is made locally on main after checks; its hash
is reported in the task delivery message. The primary pipeline file remains unmodified
by this task; this task's completion is recorded in its separate owned plan receipt.

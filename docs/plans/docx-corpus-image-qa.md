# DOCX corpus image QA

Scope: this corpus-image task only. No product implementation, README edits,
push or release. Later tasks remain pending. Existing unowned changes and old
QA outputs are excluded. Specifications: `docs/specs/docx.md`,
`docs/specs/office-cli.md`, `docs/specs/office-sdk.md`; root `AGENTS.md` applies.

## Inputs and ownership

Authenticate four disposable inputs against `docs/docx/corpus-manifest.json`:
Welsh Government race-equality easy-read response and citizen-voice easy-read
questions, the Australian Productivity Commission circular-economy illustrated
report, and the NZ Ministry for the Environment annual report 2024–2025.
Their acquisition URLs, restrictions and media hashes remain in the research
manifest. These documents and their artwork are not redistributed or adapted
into canonical fixtures. No linked-image acquisition is permitted.

Own this plan, `docs/docx/corpus-image-qa.json`,
`docs/docx/corpus-image-qa.md`, and a new original in-memory regression test if
the measured behavior warrants it. Use an exclusively created ignored
`.cache/docx-corpus/image-qa-20260915` directory for disposable outputs.
Do not overwrite any pre-existing QA directory or alter historical receipts.

## Execution

1. Read the image inventory/format/replacement/layout/fallback evidence and both
   API audits. Parse the entire API inventory; preserve inherited members,
   enum aliases, helpers, collections, returned and public underscore-prefixed
   types as obligations. Record exact JS/security mappings, without promoting
   utility observations into whole model coverage.
2. Independently stream ZIP members, check CRC/source hashes, parse XML without
   DTD/entity expansion, and census stored media by signature, extension, bytes,
   SHA-256, drawing placement, SVG extensions and resource-sharing occurrences.
   Distinguish stored resources, native drawings and selected logical images.
3. Exercise current public SDK image inventory and extraction with explicit
   capabilities. Compare every extracted payload hash to the independently read
   original part. No external relationships authorize network requests.
4. Execute selected-occurrence and explicit shared raster replacement on actual
   shared resources. Compare selected/unselected bytes, dimensions, alt text,
   relationships and all unrelated media. Record refusals separately from passes.
5. Insert an original tiny technical raster inline, with explicit dimensions and
   original alt text. Inspect dimensions/alt and exact byte preservation of all
   original graphics, including SVG, EMF and WDP.
6. Apply anchored wrapping/crop/layout changes to supported actual occurrences.
   Preserve all unsupported graphics and alternate carriers; attempt affected
   unsupported replacement and verify refusal before binary acquisition/output.
7. Render representative originals and edited outputs with the existing portable
   QA-only LibreOffice bundle at
   `tmp/docx71-layout-qa/libreoffice-mount/LibreOffice.app/Contents/MacOS/soffice`
   under the existing IP-denied sandbox and an exclusive profile/temp directory.
   This is not the installed desktop application or a product dependency.
   Inspect actual PNG pages for images, wrapping, clipping and fallback behavior.
   Keep renderer limitations distinct from XML/package results and baseline flaws.
8. Reduce measured cases to original tiny technical raster/inert signature/XML
   fixtures using existing authored fixture helpers and memfs. Run tests before
   any product code; product fixes are outside this task. A validated unresolved
   failure blocks a pass and is recorded for a later authorized implementation.
9. Run maintained `npm test --workspace=docx`, `npm run lint --workspace=docx`,
   document formatting and `git diff --check` as applicable. Record exact results.
   No CLI visual changes are authorized; document page inspection is required.
10. Seal concise evidence and exact cleanup inventory. Delete only authenticated
    selected disposable source files and newly owned output files after reduction
    and inspection; preserve other corpus files and every unowned output.
    Commit owned nonignored files explicitly on main, with this plan, using an
    atomic Conventional Commit. Report local hash only.

## Results

Executed 2026-09-15 on local main, starting at
`21f13307e9248ec1eac157491d88a6af47084d1c`. No product/README files changed.
Current working-tree specifications include existing unowned edits; they remain
untouched and their hashes are recorded in the receipt. Later tasks stay pending.

| Cohort                           | Observed result                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fresh independent census         | All four source and 280 media hashes/ZIP CRCs match; measured formats and native drawings are recorded per input.                                                                                                                                                                                                                                                                                          |
| Inventory/extraction             | 72/70/92/42 logical images; 331 resource payload hashes and four manifests match. Three inventories need explicit raised work budgets.                                                                                                                                                                                                                                                                     |
| Baseline validation              | Inputs 2/3 pass the partial profile; input 1 has 14 style/table diagnostics and input 4 has ten style diagnostics. Failed original edits write nothing.                                                                                                                                                                                                                                                    |
| Insertion                        | Inputs 2/3 succeed with authored two-color technical PNG, exact inch dimensions/alt, preserving 124/43 original media parts. Input 3 needs raised XML nodes.                                                                                                                                                                                                                                               |
| Replacement                      | Original report opaque-DPI carriers refuse; a full disposable derivative removes only five local DPI extension lists and verifies one/five-reference replacement, all geometry/alt and unrelated contents unchanged. This is not an original-carrier pass.                                                                                                                                                 |
| Anchors                          | Original report EMF crop/rotation and rotation-only pass structurally with exact media/relationship preservation. Grouped easy-read anchor editing refuses faithful preservation.                                                                                                                                                                                                                          |
| Rendering                        | Four originals and successful outputs export to paginated PDFs under IP denial. Twenty-nine representative page PNGs inspected. Existing overlap/clipping, insertion flow, replacement markers, WDP signatures, visible SVG/raster fallback and authored square/top-bottom wrapping are recorded independently from XML validity.                                                                          |
| Unresolved rendering observation | Report medallion visible after rotation alone, absent after crop/rotation. Authored complete 188-byte vector and 256-byte bitmap EMFs remain visible under the same edit; no generic EMF defect reproduced or product fix claimed.                                                                                                                                                                         |
| Reduction                        | Nine original in-memory tests pass; absent-fixture RED precedes helper code. Complete-EMF graph RED (expected 88-byte header, observed zero) precedes expansion to seven valid vector records; bitmap graph RED precedes expansion to four valid bitmap records. Initial wrapping test omitted explicit conflicting distance intent; refusal is now asserted before the successful explicit-distance edit. |
| Maintained checks                | Final `npm test --workspace=docx`: 169 files, 3367 tests, no failures, exit 0, 168.01 s. Final `npm run lint --workspace=docx`: ESLint and both source/test TypeScript checks exit 0; one existing operation-types type-only-variable warning.                                                                                                                                                             |

QA preparation errors are not product defects: the first direct SDK probe
omitted required context; a baseline-validator probe passed context in the
options slot; a text fragment omitted its namespace; a verifier reused ZipInfo
objects after writing a derivative. Corrected independent checks pass. Pillow
was absent, so page PNGs were inspected directly instead of creating a contact
sheet. No new runtime/dependency/tool installation was performed.

## Behavioral adaptation and API boundary

Pinned python-docx reference
`e45454602b53e8e572b179ccf1c91093ec9f4ed7` and inventories are research only.
`tests/image/test_image.py::DescribeImage::it_can_construct_from_an_image_blob`
and `tests/image/test_image.py::DescribeImage::it_provides_access_to_the_image_blob`
motivate original admitted-byte preservation assertions; the existing public
Image tests own exact factory/metadata coverage. The new extraction graph case
adds an original repeated-owner/manifest requirement with SHA-256, not copied
SHA-1 assertions or fixture images. Document/run inline-size behavior motivates
the independently asserted 1 × 0.5 inch insertion and geometry-preservation
cohorts; live InlineShape/ImagePart/ImageParts construction and collection rows
remain pending, rather than claiming equivalent owners from utility tests.

No binary fixtures, XML passages, mocked source values or branding were copied.
Original tiny media use deterministic colored pixels, authored EMF drawing
records and inert WDP signatures. Existing legal research notices are retained;
no substantial derived implementation requires a new notice.

The receipt and accompanying evidence give exact Promise/byte/capability,
selector/shared ownership, Length/crop/optional-value, error-status, neutral
method spelling, sequence/helper/enum and inherited/public-underscore mappings.
All 920 inventory records and 262 enum values/aliases remain visible; utility QA
promotes no historical model row. D11/D12/D13/D19 drift decisions remain explicit.
Shared plural resources, text replace, flags/JSON, schema/capabilities and exit
statuses remain authoritative. No new normative requirement was introduced, so
durable specifications were not edited by this task.

Cleanup completed: all four selected authenticated input files and 692 newly
owned output files were deleted and absence verified. The exclusive output root
is absent; all 19 other downloaded input paths and older QA outputs are
preserved. Exact file paths, sizes and hashes remain in the standalone cleanup
receipt. Corpus-independent regression verification and final formatting/diff
checks are recorded in the evidence receipt.

Deliver this atomic QA record and original tests with
`test(docx): qualify corpus image operations` on local main. The final local hash
is reported after commit. No push or release is permitted; later tasks stay pending.

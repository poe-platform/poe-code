# Current Pandoc matrix revalidation

Execute the contract matrix against the current main checkout, preserving prior
captures and unrelated work. Evidence is isolated under docs/pandoc/current-matrix.

1. Bind the current contract/inventory and pinned research clone source hashes.
   Keep all 5,100 reserved inventory IDs not-run until original case mappings exist.
2. Reuse owned Matrix integration inputs, never downloaded unit fixtures. Execute
   every available reader/writer name pair through SDK and literal adapter argv
   with memfs destinations. Retain strict feature failures separately from checks
   that those failures have the correct status and preserve destinations.
3. Compare current outputs to the earlier independently checked literal/structural
   expectations; independently parse new EPUB and PDF artifacts again. Exercise
   declared gated readers to PDF as capability-denial checks, not content passes.
4. Download the separately identified official Pandoc 3.10.1 executable and verify
   its recorded artifact/executable hashes. Capture version/help/format lists.
   Invoke only owned inputs and literal argv, with no upstream command execution.
5. Validate native JSON independently against owned expectations before comparing
   reader AST; retain provenance/content differences without stripping them.
6. Pin pypdf 6.0.0, PyMuPDF 1.26.4/MuPDF 1.26.7 and docutils 0.21.2 in an isolated
   integration environment. Validate EPUB ZIP/XML relationships independently;
   parse PDFs for exact text/page count/geometry and inspect rendered contact sheet.
7. Reduce any newly validated product mismatch to an original failing unit test
   before changing code. Unit mutations use memfs and no native executable.
8. Run maintained scoped tests/lint/build and standards checks. Report each lane's
   actual denominators and incomplete corpus coverage. Remove isolated tools.
9. Commit verified atomic improvements on main with explicit owned paths. No push.

## Validated improvement

Independent OPF validation reproduced the wrong default modified timestamp in
all 24 EPUB outputs. ZIP inspection also found the wrong archive epoch. Before
implementation, the original EPUB writer suite failed three assertions: one
local ZIP date check and the two EPUB/EPUB3 default OPF checks (18/21 passed).
The writer now uses the contract's 1970 OPF default and 1980 ZIP epoch. Explicit
modified metadata remains honored. The regression checks independently decode
ZIP local and central fields and OPF XML; no host mutation or oracle enters units.

Maintained verification after implementation: 1,067/1,067 Pandoc units,
lint/source-and-test typechecks, and the selected declaration-derived build pass.
Focused safe-bash tests pass 28/28. Independent parsing passes all 46 binary
outputs and both owned EPUB input profiles. Both parsers validate all 12 PDF
outputs; MuPDF pixel comparisons pass 12/12. Inspect the rendered contact sheet
and full CSV page; these single-page cases do not certify complex layout.

## Driver corrections and remaining scope

The initial driver passed an array to the single-input readDocument API and
mistook Shell.exec for an argv API. Correct execution uses owned safe literal
tokens joined for the virtual shell, records the literal argv, and invokes native
Pandoc directly with literal argv. No cloned Markdown instructions are executed.
The first post-fix adapter capture loaded pre-rebuild dist while SDK used updated
source; retain stale-build-execution.json and rerun with both using completed
dist. This mismatch does not justify a product adapter change.

Retain exact native provenance differences for EPUB2/3 and PPTX and the native
CommonMark terminal-code-LF difference. No content, IDs, links, spans, list order
or warnings are normalized to pass. All 5,100 reserved corpus IDs remain not-run
without original case mappings. DOCX/XLSX content-to-PDF remains not-run; actual
capability denial is a separate passing check. Strict unsupported pairs and their
lossy alternatives retain separate outcomes. Whole-corpus acceptance is incomplete.

Final completed-build rerun passes 156/156 file-output commands and 156/156
byte-stdout commands; option/capability denials pass 158/158. Bind all 46 current
binary artifacts to independent validation by SHA-256. Preserve the earlier
captures and remove isolated integration tools after recording identities.
Evidence and complete denominators are in docs/pandoc/current-matrix/summary.md.
Commit the verified epoch improvement and its evidence locally. No push or release.

# Current selected conformance matrix

This run executes selected owned cases against the current converter and thin
safe-bash adapter. **Whole-corpus and whole-contract conformance remain incomplete.**
No reserved upstream row is closed by a smoke case, skipped or moved out of scope.

| Lane | Total | Pass | Fail | Unsupported | Not-run |
| --- | ---: | ---: | ---: | ---: | ---: |
| Current upstream reserved IDs | 5,100 | 0 | 0 | 0 | 5,100 |
| Pinned source bindings | 1,170 | 1,170 | 0 | 0 | 0 |
| Native Matrix reader AST | 12 | 9 | 3 | 0 | 0 |
| Additional independently checked native AST | 7 | 6 | 1 | 0 | 0 |
| Strict SDK reader/writer conversions | 156 | 135 | 0 | 21 | 0 |
| Strict unsupported-feature rejection checks | 21 | 21 | 0 | 0 | 0 |
| Actual adapter file-output checks | 156 | 156 | 0 | 0 | 0 |
| Actual adapter byte-stdout checks | 156 | 156 | 0 | 0 | 0 |
| Unknown-option and capability denials | 158 | 158 | 0 | 0 | 0 |
| Additional explicit lossy/empty cases | 23 | 14 | 0 | 9 | 0 |
| Independent binary output validation | 46 | 46 | 0 | 0 | 0 |
| Independent EPUB2/3 input validation | 2 | 2 | 0 | 0 | 0 |
| PDF from every declared reader profile | 14 | 12 | 0 | 0 | 2 |
| Pinned rendered PDF comparisons | 12 | 12 | 0 | 0 | 0 |
| CommonMark normative examples | 652 | 652 | 0 | 0 | 0 |
| Maintained RST/docutils owned cases | 18 | 18 | 0 | 0 | 0 |
| Maintained Pandoc units after fix | 1,067 | 1,067 | 0 | 0 | 0 |
| Focused existing safe-bash units | 28 | 28 | 0 | 0 | 0 |

Lanes overlap; their totals must not be added. Available input names are asserted
against the registry: eleven reader names with EPUB2/3 counted separately gives
twelve profiles, each exercised against all thirteen available writer names.
This includes LaTeX/RST/RTF input and output, EPUB2/3 input, EPUB3 output and PDF.
Binary validation covers 24 EPUB outputs, 12 PDF outputs and 10 PPTX outputs.
DOCX/XLSX are declared gated readers: their denial checks pass, but both content
conversions to PDF remain not-run. Twenty-one strict conversions remain
unsupported; the passing rejection/adapter checks do not turn them into successful
conversions. Additional explicit lossy and empty cases do not replace those rows.
This does not establish nonempty representable content for every enabled pair.

## Verified contract fix

Independent EPUB validation found the default OPF modified date and archive
timestamps used 2000 instead of the specified epochs. Original unit assertions
failed before implementation: 3 failed, 18 passed in the EPUB writer suite.
The writer now defaults OPF modified to `1970-01-01T00:00:00Z` and uses
`1980-01-01` for every ZIP member. Explicit valid modified metadata remains
honored. Generated EPUB bytes and metadata-derived default identifiers change
accordingly. Independent ZIP local/central fields and OPF XML expectations are
asserted without host mutations or external unit dependencies.

Maintained `npm test --workspace=@poe-code/pandoc`, workspace lint/typechecks and
`npm run build:workspaces -- --workspace=@poe-code/pandoc` pass after the fix.
Focused adapter units pass with no skips. This localized fix does not claim a
repository-wide gate. Conversion logic stays in packages/pandoc; no adapter
conversion logic or native product fallback was added.

## Research and native oracle

[Source bindings](source-binding.json) verify cloned HEAD
`c9a9a5eed7185783b69043e019c067370dc09615` and all 1,170 recorded source sizes/hashes.
External Hackage identifiers resolve to the pinned external research directories,
not nonexistent clone-relative `hackage:` paths. Inventory and contract hashes
are captured; this is research authentication, not behavioral acceptance.

[Execution](execution.json) identifies the actual official ARM64 macOS **Pandoc
3.10.1** release executable separately, with version, executable/release artifact
SHA-256, complete help and supported input/output format lists. It was **not built
from cloned HEAD**. Native argv use `--sandbox`, explicit reader, `--to json` and
`--wrap=none`; the additional code case explicitly uses `--preserve-tabs`.
All native JSON expectations are independently checked against earlier owned
captures before reader comparison. Only owned input bytes and literal argv are
used. No commands in cloned upstream Markdown are executed. Downloaded tools
belong solely to this integration/oracle lane and are removed after capture.

## Independent validation and retained differences

[Independent results](independent.json) validate ZIP CRC, first stored mimetype,
all local/central archive epochs, container rootfile, OPF metadata/UID/manifest/
spine, XHTML body and namespace, ordered navigation targets/labels and fragment
closure. EPUB2 input NCX and EPUB3 input nav are checked independently with Python
zipfile/ElementTree. This is bounded validation, not full EPUBCheck certification.

PDF parsing uses **pypdf 6.0.0** and separately pinned **PyMuPDF 1.26.4/MuPDF
1.26.7**. Both check exact Matrix text and one page, with in-page word geometry.
Exact extraction expectations are `Matrix` in pypdf and `Matrix` plus one terminal
LF in MuPDF; no content normalization is used. Rendering compares pixels of old
and current owned outputs under the same pinned renderer, not PDF bytes across
layout engines. The [contact sheet](pdf-contact.png) and full CSV page were
visually inspected: prose and table content is legible and contained. These
single-page cases do not establish complex/multipage layout or font-profile
conformance. Native Pandoc is never used as a PDF parser.

Selected text writers use literal independent expectations; JSON retains AST
structure. The maintained RST writer route separately parses eighteen original
cases through docutils 0.21.2. CommonMark's maintained standards route passes all
652 normative examples. Neither route maps all upstream reserved IDs.

All three exact Matrix native AST failures remain: EPUB2/3 chapter Div/Span IDs
and metadata provenance, and PPTX slide Div versus native Header. The additional
CommonMark code terminal LF difference remains failed. Internal Table enum
strings are projected only at named colspec/cell alignment fields to their
lossless JSON constructors. Content, IDs, links, spans, list order and warnings
are not stripped or normalized. These retained contract/native differences do
not justify speculative implementation changes.

## Capture discipline and incomplete work

The initial manual driver used the wrong readDocument argument shape and the
wrong Shell.exec call shape; these were driver failures, not product defects.
The first post-fix capture compared updated SDK source with pre-rebuild adapter
dist; [that failed capture](stale-build-execution.json) is retained. Final SDK and
adapter execution both use the completed build. Each final binary artifact is
bound to its independent validation SHA-256. Earlier pre-fix captures remain
separate; only the final independent checks certify the changed artifact bytes.

Unit changes are original in-memory cases. No downloaded fixture, executable,
LLM or host scratch file was introduced into units. QA procedure is in
[the task plan](../../plans/pandoc-matrix-current-revalidation.md); evidence stays
here. Manifest hashes bind candidate source/tests, dist, adapter and captures.
The recorded base commit predates the epoch fix; exact changed bytes are bound
by the manifest, not falsely attributed to that base hash.

All 5,100 reserved inventory IDs remain not-run without original local case
mappings. Contract flags/profile behavior beyond the selected cases and existing
maintained suites are not fully accepted; strict/lossy and gated conversion gaps
remain visible. No push, remote-main verification or release was performed.

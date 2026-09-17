# Pandoc conformance execution

This is selected-case matrix evidence, **not whole-corpus or whole-contract
acceptance**. All enabled names are exercised, but strict nonrepresentable
publication provenance remains unsupported in several pairs. No upstream row
was closed, skipped to completion or moved out of delivery scope.

| Lane | Total | Pass | Fail | Unsupported | Not-run |
| --- | ---: | ---: | ---: | ---: | ---: |
| Upstream original local inventory IDs | 4,211 | 0 | 0 | 0 | 4,211 |
| Inventory source file bindings | 1,136 | 1,136 | 0 | 0 | 0 |
| Native reader AST, Matrix inputs | 12 | 9 | 3 | 0 | 0 |
| Additional independently authored native AST cases | 7 | 6 | 1 | 0 | 0 |
| SDK strict reader/writer rows | 156 | 135 | 0 | 21 | 0 |
| Strict unsupported-feature rejection checks | 21 | 21 | 0 | 0 | 0 |
| Actual safe-bash command rows | 156 | 156 | 0 | 0 | 0 |
| Unknown options/capability denial | 147 | 147 | 0 | 0 | 0 |
| Additional lossy/empty representable cases | 23 | 14 | 0 | 9 | 0 |
| Independent binary output parsing | 46 | 46 | 0 | 0 | 0 |
| EPUB2/3 independent input validation | 2 | 2 | 0 | 0 | 0 |
| Declared reader profiles to PDF | 14 | 12 | 0 | 0 | 2 |
| MuPDF rendered PDF comparisons | 12 | 12 | 0 | 0 | 0 |
| CommonMark normative examples | 652 | 652 | 0 | 0 | 0 |
| Maintained RST/docutils original cases | 12 | 12 | 0 | 0 | 0 |
| Maintained Pandoc package unit tests | 970 | 970 | 0 | 0 | 0 |
| Existing focused safe-bash unit tests | 24 | 24 | 0 | 0 | 0 |

Lanes overlap; do not add their denominators. Twelve input profiles means eleven
enabled reader names, with EPUB2 and EPUB3 separately counted. Thirteen writer
names include HTML/HTML5 and EPUB/EPUB3 aliases. Binary parsing covers 24 EPUB,
12 PDF and 10 PPTX outputs. The declared PDF denominator additionally retains
gated DOCX and XLSX readers; their content conversions were not executed.
Unknown-option rows cover 143 name pairs plus four capability denials.
The maintained RST integration route also passed its twelve owned writer cases
against docutils 0.21.2; it is not an upstream-ID acceptance run.

## Bound sources and independent tools

Clone HEAD is `c9a9a5eed7185783b69043e019c067370dc09615`; all 1,136 source files
listed in `upstream-cases.json` match their recorded size and SHA-256.
[Source evidence](matrix-source-binding.json) also binds the inventory and contract.

The executable oracle is the official **Pandoc 3.10.1 ARM64 macOS release**,
downloaded separately. It was **not built from the research clone HEAD**.
[Final evidence](matrix-final.json) records executable path, version, binary and
release-artifact SHA-256, supported help flags and input/output inventories.
Literal native argv use sandbox, explicit formats and wrap none. Preserve-tabs
is separately identified for the owned literal code case. No cloned Markdown
command is executed; native tooling is never a product or unit-test dependency.
The isolated tool directory was removed after capture.

Python zipfile/ElementTree independently check EPUB container/OPF/XHTML/nav
and EPUB2 NCX. PDF parsing uses pypdf 6.0.0 plus PyMuPDF 1.26.4 with MuPDF 1.26.7;
the renderer is separately pinned and never called by product code or unit tests.
[Independent results](matrix-independent.json) retain checks and artifact paths.
[Rendered comparisons](matrix-pdf-contact.png) were visually inspected, as was
the full CSV PDF page. Single-page Matrix content does not certify complex or
multipage layout, arbitrary publication CSS or full EPUBCheck conformance.

## Exact differences and retained unsupported rows

EPUB2 and EPUB3 reader ASTs differ from native JSON in chapter provenance IDs,
containers, navigation metadata and metadata value constructors. PPTX differs
in slide Div provenance versus native's generated Header. These differences are
retained as failed exact native comparisons, even where the local contract
defines provenance behavior. Nothing strips IDs, spans or metadata to pass.

The additional code case independently validates native JSON with preserve-tabs.
Native removes the terminal code LF; the CommonMark implementation retains it,
consistent with its normative HTML projection. The exact AST comparison stays
failed. The original default native tab expansion is also preserved in evidence.
No code-content normalization or speculative product fix was applied.

Internal table alignment enum strings are projected **only at the named Table
tuple enum fields** to JSON `{t: ...}` constructors. This is lossless AST wire
representation, not content normalization. Cell order, spans, body text, IDs
and links remain byte/value unchanged. Initial incorrect raw-internal-versus-JSON
comparisons and stale LaTeX table expectations remain in earlier captures.
The two table rows were independently retested against an explicit one-LF literal
expectation after the LaTeX fix.

All 21 strict unsupported rows remain listed in final evidence. Explicit lossy
and empty cases are additional rows, not substitutes. Nine of these cases still
have no admitted lossy reduction. EPUB provenance makes some strict pairs
nonrepresentable even for Matrix prose; therefore this run does not establish
representable nonempty content for every enabled pair.

The local inventory's 4,211 reserved test IDs remain not-run: these selected owned
cases have no asserted ID mapping. Required formats stay in scope. This task
does not establish all contract flags, loss diagnostics, resource admission or
format-profile compliance; older E_RESOURCE/E_WARNINGS and warning naming remain
reconciliation items. No whole-repository gate, remote delivery or release is claimed.

## Verified changes and checks

Failing-first original unit cases reproduce command status mapping, Markdown
feature errors, LaTeX terminal LF and publication feature errors. Unit mutations
use memfs; no downloaded fixtures, executables, LLMs or host scratch files enter
the added unit tests. Conversion logic remains in packages/pandoc; the actual
safe-bash adapter was exercised without adding conversion logic or native fallback.

Maintained package tests, package lint/source-and-test typechecks and the selected
declaration-derived build closure pass. Focused safe-bash tests pass 24/24, with
zero skips. [Actual command screenshot](matrix-command.png) was inspected for
typed diagnostics, statuses 5/2/3 and preserved destinations. Maintained generic
screenshot tooling was used because there is no root Pandoc CLI subcommand.

Local commits on main:

- `a365efb0a` — preserve typed command error statuses.
- `efe274a3b` — classify Markdown nonrepresentable features.
- `cf84b6732` — serialize exactly one LaTeX terminal LF.
- `c1ee16883` — classify publication writer feature rejections.

QA procedures are in [the task plan](../plans/pandoc-conformance-matrix.md).
Only explicitly owned paths were staged. Unrelated plan/public-wiring work was
preserved. **No push, remote-main verification or release was performed.**

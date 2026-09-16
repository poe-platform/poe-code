# CSV/TSV acceptance evidence

The original TypeScript readers are document-table readers. They do not evaluate
formulas, infer numeric types, build spreadsheets or write XLSX. The existing
descriptor registry and thin safe-bash inspection adapter discover both readers.
General safe-bash conversion-command wiring remains a separate converter task.

## Native comparison

44 original literal-input probes were run outside unit tests against the official
Pandoc **3.10.1 arm64 macOS** release executable. The executable was downloaded
only as a temporary QA oracle because the previously recorded Homebrew binding
was unavailable. The release URL, executable hash, argv, exact input strings,
native exit codes/stderr/JSON and TypeScript outputs are in
[csv-tsv-native.json](csv-tsv-native.json). No upstream fixtures or golden outputs
were imported into the unit suite. The oracle is never a runtime fallback.

Outcomes: **24 exact JSON matches**, **2 matching rejection classes**, **18
different outcomes**. Exact JSON means deep equality of parsed Pandoc JSON,
independent of key ordering. Matching rejection class means both reject malformed
CSV, not matching error text/location bytes. Every probe has an explicit outcome.

| Different cases | Explicit policy / native difference |
| --- | --- |
| CSV/TSV `blank`, `blank-records`, `two-newlines` | Preserve each blank record as one empty cell. Native drops trailing blank records; the leading-blank cohort rejects later content. |
| CSV/TSV `spaces` | Preserve each space in every field. Native skips spaces after delimiters and collapses runs. |
| CSV/TSV `ragged` | Expand to the widest row and pad all rows. Native fixes width from the header and drops excess cells. |
| CSV `plain-quote`, `space-before-quote` | Whole-field quoting only; reject quotes within unquoted fields. Native accepts those quotes as literal text. |
| CSV `space-after-quote` | Reject text, including spaces, after the closing quote. Native accepts and discards trailing whitespace. |
| CSV/TSV `literal-cr` | Shared UTF-8 normalization maps bare CR to LF. Native removes bare CR in this cohort. |
| CSV `tab-in-quotes` | Preserve the embedded tab as text. Native converts it to `Space`. |
| TSV `quoted`, `tab-in-quotes` | Quotes never protect tabs. Preserve every resulting column by widening the table. Native also splits tabs, then drops cells beyond header width. |

Exact matches include empty files, first-row headers, quoted CSV commas/doubled
quotes, one-column/header-only inputs, empty trailing cells, final record
termination, CRLF, BOM, multiline CSV line breaks, leading zeroes and formulas.
TSV multiline/literal quote cases also match when no column is dropped.

## Bounds and original tests

`ConversionContext.limits` allows only lowering the finite defaults:
`tableFieldText` = 1,048,576 decoded UTF-16 units per field, `tableRows` = 10,000
records including the header, `tableColumns` = 1,024 per table. `tableCells` =
100,000 includes rectangular padding and aggregates across inputs. Existing
input-byte, text, retained-byte, node and work budgets and cancellation apply.
No environment variables are exposed.

The tests use original strings and byte chunks only. They create no files,
invoke no native executables/LLMs, and do not load native captures. BOM and
multibyte Unicode are tested at every byte split, including inside quoted CSV
with CRLF and doubled escapes. Lowered budgets exercise decoded Unicode/escape
length, records, columns, padded cells and conversion-wide cell aggregation.
CSV syntax errors assert format, operation and one-based normalized line/Unicode
scalar column through both `readDocument` and `convert`.

Before implementation: 19 original reader tests failed while all 479 existing
tests passed. A separate original diagnostic-location test failed concretely
because the execution boundary discarded the reader's format/location. The
boundary now retains those values while attributing the caller's operation.

Final maintained checks passed: **502 package tests**, package ESLint and both
source/test TypeScript checks, and the selected `@poe-code/pandoc` workspace build.
Maintained verification and QA procedure are recorded in
[the scoped plan](../plans/pandoc-csv-tsv-readers.md). No visual CLI layout was
changed. These results do not certify the full converter or XLSX engine.

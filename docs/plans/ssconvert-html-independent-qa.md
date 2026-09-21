# Independent HTML import stress QA

The independent agent reviewed the implemented importer on 2026-09-20. Git,
exports, command integration, and release ownership remain with the root agent.
No publication or push was requested or performed.

## Reference and procedure

Use the root-authenticated Gnumeric 1.12.61 archive, SHA-256
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
Source inspection is confined to `out/ssconvert-lifecycle/gnumeric-1.12.61` and
the captured libxml 2.9.14 `out/ssconvert-html/HTMLparser.c`.

Run the separately built native oracle in Docker context `colima`, container
`ssconvert-statistics-qa`, executable
`/out/ssconvert-statistics-oracle/prefix/bin/ssconvert`, with
`GSETTINGS_SCHEMA_DIR=/out/ssconvert-statistics-oracle/prefix/share/glib-2.0/schemas`,
`GSETTINGS_BACKEND=memory`, `LC_ALL=C`, and `TZ=UTC`. Select importer
`Gnumeric_html:html` and exporter `Gnumeric_XmlIO:sax:0`. This executable is QA
infrastructure, never an implementation capability or fallback. Initial root
captures without the schema environment include unrelated GOConf warnings and
are not the diagnostic oracle for this review.

Create original small inputs only under `out`, capture status and stderr, and
inspect native XML for sheet names, cell coordinates, values, and comments.
Compare these expectations to in-memory TypeScript tests. Unit tests neither
invoke the oracle nor create files. SDK resource-I/O coverage uses the root
agent's memfs tests. After review, purge temporary outputs and retain the
following verified findings here.

## Verified findings

- Malformed adjacent cells and rows recover in native order. A paragraph inside
  a cell contributes text without a line break. A self-closing nonvoid span
  preserves subsequent text and does not change following-cell coordinates.
- Named references without semicolons remain literal. Numeric references without
  semicolons decode; both `x` and `X` introduce hexadecimal values. Zero and
  surrogate numeric references disappear. Numeric 128 remains U+0080, rather
  than the HTML5 euro substitution. The failing regression preceded the repair.
- Native short-line invalid numeric references and unknown HTML4 elements emit
  source filename, line, source excerpt, and caret diagnostics. The importer now
  emits these measured diagnostics with ordering by source position. The known
  element inventory comes from libxml's HTML4 table. Long-line context uses the
  measured 80-character excerpt and caret column 79.
- Root command-level TDD exposed a duplicated warning newline: the command's
  text-diagnostic path adds a newline to a message that already ends in one.
  HTML diagnostics now provide the existing raw-byte diagnostic payload as well
  as the message, preserving the native single final newline.
- Scripts and styles contribute no cell text and are never executed. Image
  URLs become comments without fetching. Frame fallback text contributes cell
  text; frame URLs are never fetched.
- Comments do not contribute text. Inline whitespace preserves the native
  `a b\nc` result, including the newline between formatting elements.
- Nested tables create later sheets while outer cell text records the sheet
  reference. Caption text retains serialized entity spelling: `N &amp; X` is the
  actual sheet name. A following uncaptioned table appends to the restored outer
  sheet, rather than creating another sheet.
- A root-captured UTF-8 metadata fixture exposed a further serialized-text
  mismatch: nonascii caption characters, hyperlink targets, and image comments
  must preserve Unicode, including NBSP and supplementary characters. An
  independent failing regression preceded the repair. Ampersand escaping remains
  consistent with the separate measured caption and hyperlink fixtures.
- Unmarked UTF-8 bytes are interpreted as Latin-1. UTF-8 meta declarations select
  UTF-8; Latin-1 bytes remain Latin-1 without a declaration. Charset declarations
  inside comments are ignored. A UTF-16LE BOM survives as U+FEFF in B1 and shifts
  subsequent table rows. Both encoding repairs had failing regressions first.
- Node, retained-text, work, sheet, cell, and depth limits reject the measured
  fixtures with `resource-limit`. Pre-aborted cancellation and cancellation from
  an awaited diagnostic handler retain the original reason object by identity.

## Checks and limits

The independent file `packages/ssconvert/src/codecs/html-independent.test.ts`
passes 13 tests. Focused ESLint and both package TypeScript source/test checks
passed during this review; root owns the maintained workspace build/test/lint
closure and command integration checks.

Remaining mismatches and unmeasured cases are not passes: the complete libxml
syntax-error inventory is not implemented (unexpected closing tags, incomplete
attributes, malformed declarations, invalid encoding sequences). Numeric
references without any digits are not covered. Charset switching after the
initial 4096 bytes, unsupported decoder labels, UTF-32/EBCDIC, and UTF-16BE BOM
effects remain unmeasured. The full parser depth-limit diagnostic does not match
native libxml's diagnostics. Exhaustive span-overlap, sheet-name normalization,
formula/date inference, and CSS/Excel metadata coverage remain the root report's
responsibility. No full HTML/libxml compatibility claim follows from this scoped
review.

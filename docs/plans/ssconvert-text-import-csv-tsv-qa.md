# text-import-csv-tsv QA

This report covers the TypeScript ESM `ssconvert` text importer and its existing
opt-in Safe Bash command. Native Gnumeric is a separate QA oracle, never a runtime
dependency or fallback. No README changes, pushes or publication are part of this task.

## Reference profile captured September 20, 2026

The retained primary archive in `out/ssconvert-lifecycle-oracle` was independently
hashed before implementation: Gnumeric 1.12.61, SHA-256
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
Primary source inspection used `out/ssconvert-lifecycle/gnumeric-1.12.61/src/stf.c`,
`stf-parse.c`, `number-match.c`, `sheet.c`, and the retained GOOffice encoding/locale
helpers. Primary source stays under `out`.

The measured oracle is the retained arm64 Linux build at
`/out/ssconvert-statistics-oracle/prefix/bin/ssconvert` in the separate QA container
`ssconvert-statistics-qa`. Its binary SHA-256 is
`104f1e5500432c95ac3d46a679d476d05d2bf84e7483e991d212703cb0ed131c`.
`--version` returned status 0 and version 1.12.61. This is a distinct binary binding
from the older lifecycle profile; their hashes must not be interchanged.

Captured environment: `LC_ALL=C`, every locale category `C`, `TZ=UTC`,
`LD_LIBRARY_PATH=/out/ssconvert-statistics-oracle/prefix/lib`,
`GSETTINGS_SCHEMA_DIR=/out/ssconvert-statistics-oracle/prefix/share/glib-2.0/schemas`,
`GSETTINGS_BACKEND=memory`. Omitting the schema directory caused GOConf critical
messages; those preliminary observations were not used as a clean diagnostic profile.

Captured Debian dependencies:

| Dependency | Version |
| --- | --- |
| libc6:arm64 | 2.41-12+deb13u4 |
| libglib2.0-0t64:arm64 | 2.84.4-3~deb13u5 |
| libgsf-1-114:arm64 | 1.14.53-1 |
| libgtk-3-0t64:arm64 | 3.24.49-3 |
| libpango-1.0-0:arm64 | 1.56.3-1 |
| libxml2:arm64 | 2.12.7+dfsg+really2.9.14-2.1+deb13u3 |

Linked GOOffice uses the separately retained 0.10.61 build. The captured installed
noninteractive importer IDs, in native order, were:

```text
Gnumeric_Excel:excel
Gnumeric_Excel:excel_enc
Gnumeric_Excel:excel_xml
Gnumeric_Excel:xlsx
Gnumeric_OpenCalc:openoffice
Gnumeric_QPro:qpro
Gnumeric_XmlIO:sax
Gnumeric_applix:applix
Gnumeric_dif:dif
Gnumeric_html:html
Gnumeric_lotus:lotus
Gnumeric_mps:mps
Gnumeric_oleo:oleo
Gnumeric_plan_perfect:pln
Gnumeric_sc:sc
Gnumeric_stf:stf_csvtab
Gnumeric_sylk:sylk
Gnumeric_xbase:xbase
```

`Gnumeric_stf:stf_assistant` is absent from the noninteractive importer listing.
Explicit `-I Gnumeric_stf:stf_assistant` is recognized and returns status 1 with
`E This importer can only be used with a GUI.`, leaving the destination untouched.
Its exporter remains a separate service. The product preserves that distinction.

Captured exporter IDs were `Gnumeric_Excel:excel_biff7`, `excel_biff8`, `excel_dsf`,
`xlsx`, `xlsx2`; `Gnumeric_OpenCalc:odf`, `openoffice`; `Gnumeric_XmlIO:sax`, `sax:0`;
`Gnumeric_dif:dif`; `Gnumeric_glpk:glpk`; `Gnumeric_html:html32`, `html40`,
`html40frag`, `latex`, `latex_table`, `latex_table_visible`, `roff`, `xhtml`,
`xhtml_range`; `Gnumeric_lpsolve:lpsolve`; `Gnumeric_pdf:pdf_assistant`;
`Gnumeric_stf:stf_assistant`, `stf_csv`; and `Gnumeric_sylk:sylk`. Abbreviated IDs
in each group retain the preceding provider namespace.

## Procedure and evidence

1. Add original in-memory fixtures and reproduce failures before runtime edits.
   The initial three importer tests failed with unsupported-file errors. Later
   date/precision, formula calculation and assistant tests failed separately.
2. Inspect the stable source helpers and measure original small fixtures with the
   separately bound native oracle. Use the captured environment above; retain
   exact statuses, stderr and native XML only under `out` during measurement.
3. Run candidate SDK imports with injected byte streams and a deterministic clock,
   compare sparse cell coordinates, types, numeric values and native `ValueFormat`
   where present. Native unit-test spawning is prohibited.
4. Have a different agent stress and repair the implemented parser. Its independent
   fixtures use memory and memfs; no host file creation or native execution in unit tests.
5. Exercise the actual Safe Bash command and SDK engine with the same input and
   checkpoint writer, assert exact bytes/diagnostics/status/namespace effects,
   then inspect the importer listing screenshot visually.
6. Run the maintained selected workspace build, full ssconvert package unit/lint
   routes and focused Safe Bash command tests. Record blocked gates separately.
   Purge task-owned temporary logs, fixtures and generated screenshots after review.

## Verified scope

The independent scalar differential run passed **29/29** measured C-locale cases:
`1,2`, `1,234`, `1.234,56`, `0,123`, `(12)`, `12-`, `12%`, `$12`, `12 $`,
`1/2/20`, `12/31/2020`, `2020-12-31`, `31-Dec-2020`, `January 2, 2020`,
`12:30`, `25:30:00`, `1 1/2`, `#N/A`, `#DIV/0!`, ` true `, `TRUE`, Arabic-Indic
`١٢`, Unicode minus `−12`, overflow `1e309`, literal `0x12`, `1.2.3`, invalid
grouping `1,2,3`, yearless `1/2`, and `2020/2/29`. Yearless dates use an explicit
injected clock and timezone; this run used September 20, 2026 UTC.

Regression/stress fixtures also cover multiline/doubled quotes, discarded garbage
after closing quotes, unterminated quoted fields, CR/LF/CRLF choice, TSV trimming,
GLib whitespace versus FEFF, sparse blank/trailing fields/rows, header-aware DMY
inference, consistent column decimal precision, literal apostrophes and `+`/`@`
introducers, valid formulas and rejected unknown names, empty named/unnamed files,
Unicode controls/private-use/supplementary separators, the 512-byte probe bound,
NUL-stopped probes, NUL replacement, invalid encoding overrides, BOM handling,
incomplete final encoded characters, long rows, expanded sheet sizes, column
overflow, input/cell budgets and cancellation after awaited diagnostics.
The independent reviewer repaired and covered UTF-7 shifts, explicit UTF-32
endianness, common Latin-1 aliases and CP1252 undefined-byte fallback. A final
root regression also verifies formulas referencing columns beyond the initial
256-column sheet after native size expansion.

The importer listing screenshot was generated through the real `runCommand`
engine and visually inspected: one noninteractive text importer, full description,
aligned columns, no assistant importer.

## Final local checks

| Check | Outcome |
| --- | --- |
| `npm run build:workspaces -- --workspace=@poe-code/ssconvert --no-cache` | Passed selected maintained build closure |
| `npm run test --workspace=@poe-code/ssconvert -- --no-cache` | 129 files, 3427 tests passed |
| `npm run lint --workspace=@poe-code/ssconvert` | ESLint and source/test TypeScript checks passed |
| Focused Node test route for Safe Bash `ssconvert.test.ts` and `ssconvert-text.test.ts` | 41 tests passed against rebuilt exports |
| Scoped ESLint from the Safe Bash workspace for those two command test files | Passed |
| Separate reviewer `text-independent.test.ts` | 26 tests passed; included in package total |
| Root `text.test.ts` | 25 tests passed; included in package total |
| Ad hoc native scalar differential, repeated after final edits | 29/29 passed |
| Listing screenshot through actual command engine | Inspected and passed |
| `npm run typecheck --workspace=@poe-platform/safe-bash` | Blocked before compilation; see exact guard/manifest mismatch below |

No test timeout changes, weakened assertions, native product dependencies,
README edits, pushes or releases. The earlier tests that assumed an empty installed
registry now assert the exact installed text services; unsupported-content fixtures
use an original control byte instead of printable text. Custom lifecycle fixtures
declare their name probe explicitly so the new native text name pass cannot consume
their `.csv` fixture inputs.

## Remaining mismatches and unmeasured scope

- GLib warning stderr includes native PID/time/process framing. Product diagnostics
  preserve measured warning message bodies and ordering, but do not reproduce that
  native framing. NUL and overflow stderr bytes therefore are not full parity passes.
- Native iconv supports more encoding names/aliases than WHATWG TextDecoder and
  the explicit converters. The entire iconv charset/alias inventory is unmeasured;
  supported common encodings do not establish complete encoding parity.
- Non-C text-import locales have not been differentially qualified in this task.
  Existing locale profiles/derived separators are not proof of native import parity.
- Date/time inference is not a complete port of `number-match.c`: combined date/time,
  AM/PM, compact ISO timestamps, arbitrary localized month names, alternate currency
  symbols, fractional-second format precision and the full date ambiguity grammar
  remain unmeasured. The 29 scalar cases do not certify these families.
- Yearless dates require an explicit clock, unlike the native ambient clock. Full
  16,777,216-row overflow and exhaustive Unicode-version equivalence were not run.
- Formula syntax/calculation uses the existing shared bounded engine; this task
  verifies literal introducers, unknown names and small accepted formulas, not all
  Gnumeric formula functions, volatile capabilities or external workbook references.
- Exact native column style records, autofit dimensions and save-info metadata are
  not measured here. Cell values/formats and power-of-two dimensions do not certify
  all workbook metadata.
- Maintained Safe Bash typecheck currently exits 2 before compilation: the current
  root manifest lacks `./safe-fs` while the guard requires the canonical shared
  SafeJS runtime export. That manifest and guard have other existing edits and were
  preserved. Focused runtime command tests do not replace this blocked gate.

Unsupported or unmeasured cases above are not passes. No full Gnumeric parity or
repository-wide release readiness is claimed.

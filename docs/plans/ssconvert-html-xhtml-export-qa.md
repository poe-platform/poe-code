# HTML and XHTML export QA

Executed 2026-09-20. Implement all five provider write handlers in TypeScript
ESM through the existing ssconvert engine and opt-in safe-bash virtual command.
Preserve pre-existing edits. No README, shared exports, Git commits, push,
publication, native fallback or product process capability is authorized here.

## Reference profile and repeat procedure

Reuse the primary archive already acquired under
`out/ssconvert-lifecycle/gnumeric-1.12.61.tar.xz`; verify SHA-256
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
This verification succeeded. Inspect `plugins/html/html.c`, `font.c`,
`plugin.xml.in`, `src/sheet.c` and `src/gutils.c` inside that out tree.
Document templates retain the original copyright/license notice.

The QA oracle is separate: Docker context `colima`, container
`ssconvert-statistics-qa`, binary
`/out/ssconvert-statistics-oracle/prefix/bin/ssconvert`, SHA-256
`104f1e5500432c95ac3d46a679d476d05d2bf84e7483e991d212703cb0ed131c`.
Its captured version is 1.12.61. Set `LC_ALL=C`, `TZ=UTC`,
`GSETTINGS_BACKEND=memory`, and
`GSETTINGS_SCHEMA_DIR=/out/ssconvert-statistics-oracle/prefix/share/glib-2.0/schemas`.
Dependency profile: built GOffice 0.10.61, libgsf 1.14.53-1,
GLib 2.84.4-3~deb13u5, GTK 3.24.49-3, Pango 1.56.3-1,
Harfbuzz 10.2.0-1+deb13u1, fontconfig 2.15.0-2.3, libxml2
`2.12.7+dfsg+really2.9.14-2.1+deb13u3`. Sans resolves to DejaVu Sans Book.
These are the measured current dependency versions, not an assertion that
Gnumeric historically released with exactly this dependency snapshot.

Capture native `--list-exporters`: installed write services in this oracle are
Excel biff7/biff8/dsf/xlsx/xlsx2; OpenCalc odf/openoffice; XmlIO sax/sax:0;
dif; glpk; html32/html40/html40frag/latex/latex_table/latex_table_visible/roff/
xhtml/xhtml_range; lpsolve; pdf_assistant; stf_assistant/stf_csv; sylk.
All five required HTML services are installed. Native translated descriptions
use the captured C output channel; locale/plugin variants are not passes.

For each original small fixture, save native output under out with
`ssconvert -T Gnumeric_html:<id> input.gnumeric output.html`. Capture status,
stderr and raw bytes. Run the actual JavaScript `runCommand` with the same
input bytes and injected output I/O; compare Uint8Array bytes, status and stderr.
Do not run this oracle from unit tests. Unit fixtures are original in-memory
workbooks/XML; file effects use memfs. DOM inspection supplements byte parity.

## Verified coverage

Root verified five actual built CLI byte comparisons for a two-sheet fixture
containing B2 escaped text, Unicode, a newline, C3 negative number, missing cells,
and an empty second sheet. Every native and JavaScript invocation returned 0
and empty stderr. Document/fragment wrappers, doctypes, XHTML namespace,
generator, style template, attribute spacing/order, decimal entities, Unicode
minus, empty-sheet cell and sheet ordering matched exactly.

The separate agent verified 35 further actual command/engine byte comparisons
against final source: see `ssconvert-html-export-independent-qa.md`. Together
these are 40 matching CLI comparisons, plus one separately measured overflow
mismatch; the latter is excluded from passes.

Additional native source fixtures and failing-to-passing regressions verify
byte-offset overlapping rich-text segmentation, displayed formulas with
DisplayFormulas enabled, and replacement of overlapping styles on absent blank
cells. A native partial style resets omitted font/default properties; blank
cells must use the last region rather than inherit earlier regions.

Native default `.html` conversion matches explicit `Gnumeric_html:xhtml`.
Native `xhtml_range --export-range=B2:B2` matches its ordinary output: this
released writer exports the active sheet extent, retains the full XHTML wrapper,
and omits captions. It does not consume the export-range rectangle.
Native range-saver `-S` returns 1 and exactly:
`Selected exporter (Gnumeric_html:xhtml_range) does not have the ability to split a workbook into sheets.`
The declarative range scope and sheet-selection metadata drive SDK/command
validation; no provider-specific engine branch was added.

The safe-bash memfs tests verify all five command/SDK output byte equivalences,
calculated formula results, default saver file output, ordered/repeated sheet
selection, range extent behavior, split rejection, HTML import replay, unchanged
inputs, output namespace and preserved existing destination on export budget
failure. Writer unit checks preserve cancellation reason identity and reject
sparse output/node and output-byte budgets. Independent DOM checks verify table,
row/cell counts, caption decoding and XHTML namespace. No implicit URL fetches,
image decoding/execution, host processes or additional resource reads were added.

Screenshot procedure: use the maintained `scripts/screenshot.ts` capture tool
with the built shared command engine listing, `--no-header`, and output in out.
The inspected screenshot shows all five saver rows clearly, aligned with the
existing ID/description columns. No screenshot test was added.

## Verification gates

- `npm run build:workspaces -- --workspace=@poe-code/ssconvert --no-cache`:
  passed the maintained declared dependency closure (office-package, safe-fs,
  ssconvert); final output reports three builds, with caching disabled.
- `npm run test --workspace=@poe-code/ssconvert`: fresh full package Vitest run,
  180 files / 4552 tests passed. This package command has no task-cache lookup.
- `npm run lint --workspace=@poe-code/ssconvert`: provider generation, ESLint,
  source TypeScript and test TypeScript checks passed.
- `node --import tsx --test packages/safe-bash/tests/commands/ssconvert.test.ts`:
  fresh focused command integration suite; all 54 tests passed.
- Focused ESLint on the changed safe-bash command test passed.
- `npm run typecheck --workspace=@poe-platform/safe-bash`: failed, exit 2,
  before source checks/consumer groups. Its current consumer gate requires root
  `./safe-fs` to import `./packages/safe-js/dist/safe-fs.js`; the manifest has no
  such export. `git show HEAD:package.json` confirms the same absent export.
  Zero current consumer groups and zero runtime executions were verified by this
  failed gate. No export/assertion was changed to bypass it.

## Remaining mismatch and unmeasured cases

Measured mismatch: overflowing default-font text requires native rendering
metrics and row spans. Native A1 text
`abcdefghijklmnopqrstuvxyz abcdefghijklmnopqrstuvxyz` emits `colspan="6"`;
the JavaScript writer emits a plain cell. Exact Gnumeric HTML parity is therefore
incomplete. Width-dependent numeric truncation, wrapping/shrinking/rotation,
font shaping/fallback and centered/right overflowing spans are also unmeasured.

All border styles and merged-corner border combinations, conditional formatting,
indexed format colors (named colors are implemented), external-file/mail/internal
hyperlink combinations, duplicate overlapping rich-text attributes, invalid
UTF-8 run boundaries, locale/plugin/dependency variants, alternate runtimes,
object anchor variants and exhaustive range/sheet spans are unmeasured.
Existing shared formatter/parser limitations retain their existing QA scope.
No exhaustive HTML/XHTML compatibility claim follows from these checked cases.
Native malformed XHTML quirks such as `<br>` are intentionally preserved in
byte output; DOM checks do not silently rewrite those bytes.

No full repository build/test/lint, full safe-bash suite or e2e run was performed
for this focused exporter change. Native and memory checks are fresh; unmeasured
cells and failed broader gates are not passes. Run-owned scratch outputs are
purged after the final evidence is incorporated; existing archives and unrelated
out files remain untouched. Local commits: none. Remote delivery: none.
Publication/release: none.

# HTML import QA procedure

Use Gnumeric 1.12.61 as a separate oracle; never invoke it from product or unit
tests. Preserve other edits and do not push, publish, or edit README files.

1. Authenticate `out/ssconvert-lifecycle/gnumeric-1.12.61.tar.xz` against
   SHA-256 `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
   Inspect `plugins/html/html_read.c`. Record the actual oracle binary,
   dependencies, plugin inventory, locale and environment in `out/ssconvert-html`.
2. Capture original small fixtures for omitted end tags, sections, nested tables,
   repeated captions, spans, entities, encodings, text/formulas, metadata, links,
   images and active content. Save statuses, stderr and decoded native XML in out.
   Compare table extraction and sheet ordering, not browser rendering assumptions.
3. Add a failing in-memory regression before implementation. Unit filesystem
   changes use memfs and injected byte I/O. No native processes or disk fixtures.
4. Compare the selected tolerant HTML library with libxml recovery. Explicitly
   list unmeasured recovery, encoding and diagnostic cases; they are not passes.
5. Implement in the ssconvert codec/provider. Verify shared SDK/virtual-command
   behavior, cancellation, budgets, retained metadata and namespace effects.
6. Assign a different agent to stress and repair the implemented importer. Root
   retains export/integration/Git ownership. Record verified coverage and gaps.
7. Run maintained uncached workspace build/test/lint checks and appropriate
   cross-workspace checks. Inspect an ad hoc CLI screenshot if display changes.
   Remove task-owned temporary run logs after reducing evidence to this procedure.

## Verified reference behavior

The captured profile is `docs/ssconvert/html-reference-profile.json`. Its oracle
is Gnumeric 1.12.61 with libxml 2.9.14; the source archive hash was verified.
The ten original cases matched native sheet names/order, sparse cell coordinates,
values, formulas and inferred value formats: omitted closing tags, nested tables,
repeated/markup captions, active content, clipboard fragments, spans, mixed row
sections, number/text inference, malformed cells, and text outside tables.
Selected unit assertions separately cover merge placement, image comments,
hyperlink records and styles. This comparison is not complete workbook-XML parity.

Consecutive uncaptioned tables append to the existing sheet. Captions use their
serialized HTML, including `&amp;` spelling, as the sheet name. Repeated caption
names reuse the same sheet while the row cursor remains global. Nested tables
create sheets in encounter order and put a sheet reference/comment in the outer
cell. A direct row encountered after a section causes the importer to consume
only direct rows for the remainder of that table. Outside-table text goes in
column B. Line breaks and paragraphs do not insert newlines; whitespace runs
retain the original whitespace character according to the source algorithm.

The native probe recognizes `<table`, `<html`, or `<!doctype html` within the
first 200 bytes; it does not require a valid complete tag. This deliberately
competes with SpreadsheetML's lower-priority content probe. An original
SpreadsheetML fixture with an early `<Table>` was captured selecting HTML and
failing with status 1; explicitly selecting SpreadsheetML preserves that import.
An empty HTML table fails with status 1 and `Loading file:///... failed` before
publishing output. Existing destinations remain intact.

CSS, Excel `x:num`/`x:str`, alignments and table IDs do not control this native
importer. Supported formatting is header bold and first-content bold/italic,
plus hyperlink blue/underline. Scripts/styles produce no cell text and never
execute. Images become URL comments; external resources are never acquired.
Multiple visible links use the first link as the hyperlink and comment all
links in encounter order; empty links are commented in reverse encounter order.

Independent repair/coverage details are in
`docs/plans/ssconvert-html-independent-qa.md`. The implementation uses
htmlparser2 10.0.0 for tolerant tokenization and the measured libxml HTML4 entity,
automatic-close and end-priority rules for tree recovery. It uses no XML parser,
native process, host file lookup, or network fallback.

## Remaining limits

Full libxml parsing/diagnostic parity is unverified. The complete syntax-error
inventory, malformed declarations/attributes, arbitrary encoding failures and
stream-boundary diagnostic locations are not passes. Charset switching beyond
the initial 4096 bytes, UTF-32/EBCDIC, unsupported decoder labels, UTF-16BE BOM
effects and locale-dependent inference outside the captured C/UTC profile are
unmeasured. HTML serialization for uncommon attribute/element combinations and
all merge-conflict/out-of-sheet cases are unmeasured. Resource-limit failures
are intentional host limits, not native resource-exhaustion parity.

## Final verification

- `npm test --workspace=@poe-code/ssconvert -- --no-cache`: 178 files,
  4,531 tests passed, including the 13 independently authored stress tests.
- `npm run build:workspaces -- --workspace=@poe-code/ssconvert --no-cache`:
  maintained three-build dependency closure passed after the final codec repair.
- `npm run build:workspaces -- --workspace=@poe-platform/safe-bash --no-cache`:
  maintained 18-build dependency closure passed. Safe-bash imports the ssconvert
  engine from its built public package; the final codec build refreshed that input.
- `npm run lint --workspace=@poe-code/ssconvert`: ESLint and source/test
  TypeScript checks passed. Focused safe-bash integration-file ESLint passed.
- Actual safe-bash ssconvert, text, BIFF, encoding and ODF command tests:
  64 passed, zero skipped. The new cases compare SDK/command bytes, replay,
  merges, inert images/scripts, file namespace preservation, empty-table status,
  and exact warning stderr bytes. Parser warnings carry raw diagnostic bytes to
  prevent the command layer from appending another newline.
- Ad hoc screenshot of the built virtual importer listing and HTML-to-CSV
  conversion was inspected: aligned listing, readable CSV, both status 0.
  Package dry-run included the compiled HTML codec and libxml attribution notice.
- `npm run typecheck:all --workspace=@poe-platform/safe-bash` did **not** pass:
  its package build succeeded, but public peer binding stopped at
  `Public SafeFS must preserve shared SafeJS runtime identity`, observing
  `undefined` instead of `./packages/safe-js/dist/safe-fs.js`. No consumer group
  was checked. This is an unresolved wider gate, not a passing typecheck or a
  full repository gate. Unrelated public export edits were preserved.

No README edits, Git commits, pushes, publications, or releases were performed.
Task-owned temporary evidence was reduced into this procedure and the captured
reference profile before cleanup; existing source archives and other out files
were preserved.

# Chart title preservation

Scope: correct destructive title replacement in `packages/pptx`, with original
SDK and command-engine tests. Root owns the three edited package files and this
plan/research receipt. No safe-bash adapter change is needed; its scoped worker
ownership remains untouched. Preserve other work, commit locally on main, and do
not push, publish, edit README files or run the whole pipeline.

## Validated defect and implementation

Original SDK and memfs CLI assertions reproduced deletion of existing title
layout, overlay, fill and text properties. Extending the assertions reproduced
loss of rich-text body properties and list styles. Reuse the package text-frame
editor for chart rich text, admitting the exact Transitional/Strict chart rich
container names. Paragraph content follows existing whole-frame assignment
semantics; this does not promise retaining individual run formatting.

For a title without rich text, replace or insert only its text child. Preserve
the title's remaining children, attributes and chart structure. Empty title
assignment is explicit, including absent, empty, referenced and literal text.

Independent regressions additionally inspect distinct series/point fills, labels,
axis limits, sparse point indexes and explicit series number formats during data
replacement. Reject mixed plots, trendlines, error bars and extensions for data
edits while allowing a local title change. These are preservation assertions,
not implementation of the outstanding live axis/series/point model setters.

## Verification procedure

1. Run focused original tests red before each correction, then green.
2. Run maintained `npm test --workspace=pptx`, `npm run lint --workspace=pptx`
   and `npm run build:workspaces -- --workspace=pptx`.
3. Use the manifest's disposable `data-visualization-course.pptx`, verify its
   SHA-256, inventory chart records, edit one title through the built SDK, then
   inspect ZIP/XML independently and compare every untouched member's bytes.
   Host reading occurs only in this explicit QA harness, never in product code.
4. Capture the resulting human chart inventory through the repository generic
   screenshot route and inspect it. Do not run the root predev pipeline merely
   to capture this package's command output. Do not stage QA assets or screenshots.
5. Reconcile provenance against both upstream inventories and existing complete
   chart case/API ledgers; do not mark mock-object or live-model cases complete
   merely because a byte operation has related preservation assertions.

## Research and outstanding scope

See `docs/pptx/chart-editing-case-map.json` (1,407 separate parameter/BDD rows),
`chart-editing-api-map.json` (784 public records), `upstream-test-audit.md`,
`upstream-test-inventory.json`, `upstream-api-audit.md` and
`upstream-api-inventory.json`. Existing full ledgers and legal notices remain
intact. The new title receipt links exact relevant identities in research only.

The command and direct SDK share async explicit byte/VFS admission; selection
uses existing one-based slide positions and fingerprinted tokens. This change
adds no API spelling or enum, no reflection, host access, network or native
runtime. Neutral live model members, inherited and underscore-prefixed public
members, full chart-family creation and exact unadapted BDD workflows remain
outstanding. Historical audit statements that adaptation has not started refer
to their original checkpoint, not the current bounded operations.

## Execution receipt

Initial title regressions: two failures on both SDK and CLI. Extended rich-frame
assertions: two further failures before reusing the text-frame editor. A
multi-series test setup initially targeted generated namespaced markup wrongly;
the original two-series fixture now uses direct creation. No product workaround
was added for that fixture error. Final check and QA results follow below.

Maintained package tests passed: 3,430 tests in 123 files, including 18 focused
chart-preservation tests. Package ESLint and both TypeScript checks passed.
The maintained selected build closure passed for pptx and its declared build
dependencies. `git diff --check` passed for owned files. All 54 provenance pointers
in `chart-title-preservation-evidence.json` resolve, and its 47 title-case
identities are unique; seven public-member records remain explicit obligations.

Disposable corpus QA authenticated SHA-256
`ce874bc9782258175b84f5e438123552b78c993e0add9015f35d8ca2dd5c45d2`,
inventoried eight charts, and changed only `/ppt/charts/chart1.xml` with an
explicit fingerprinted selector. An independent central-directory ZIP reader
verified the new title and all 214 other members byte-for-byte. Output size was
52,907,975 bytes. The built command engine read all eight charts from the edited
bytes successfully. An initial QA recipe used nonexistent convenience fields
instead of the record token; it correctly failed ambiguous selection without
output and was corrected, not counted as successful QA.

Captured and inspected `/tmp/pptx-title-inventory.png` using
`npm run screenshot -- --output /tmp/pptx-title-inventory.png --no-header cat /tmp/pptx-title-inventory.txt`.
The saved file contains actual command-engine output. Chart structures, formulas,
links and unsupported-content notices are legible; the screenshot font lacks
some Japanese glyphs that remain intact in the UTF-8 command output. This is
terminal-output evidence, not slide-rendering or international-font fidelity.
No slide renderer ran. Disposable deck/text/image outputs remain under `/tmp`
and are not staged; the manifest input was read only.

Delivery is one atomic preservation fix with its tests, usage note and provenance
receipt. It does not finish live title/legend/axis/series/point setters or every
upstream scenario. No full-public-API claim, README edit, push or release.

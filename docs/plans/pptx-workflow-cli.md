# Table and text workflow integration assertions

## Scope and ownership

The CLI worker owns only `packages/safe-bash/tests/commands/pptx/workflow-examples.test.ts`
and this plan. Root owns staging and local commits; no push or release. Tests use
original plant labels and memfs, with no downloaded assets or host I/O. This is
an assertion-only change; no product behavior or visual CLI output changed.

## Cases

The seven original tests pair direct safe-bash calls with SDK operations and
independent ZIP/namespace-aware XML assertions. Six switch cases each enable and
disable first/last row, first/last column, horizontal banding and vertical banding
on a 2x2 table. Exact persisted XML values are `1` and `0`. The column workflow
sets a 3x3 table's middle column to 1.5 inches through a virtual script, checks
1371600 EMU, neighboring 300 EMU columns, all nine original cell values and the
1372200 EMU enclosing width. A successful read has affected zero; edits target one.

Pinned research examples: `features/tbl-table.feature` first/last row/column and
banding setters; its 3x3 iteration scenario supplies the nine-cell boundary.
`features/tbl-column.feature` supplies the exact 1.5-inch setter boundary.
The linked workflow accounting owner records exact identities separately; these
cases do not establish complete collection/model API or renderer coverage.

## Verification

The initial test setup omitted mandatory table geometry; all seven failed fixture
admission. Supplying the required original box fixed the setup without a product
change. Seven focused integration tests then passed. Maintained discovery includes
the new test file automatically, without changing discovery or historical tests.
The final run after root's maintained pptx build is recorded below.

## Concrete outstanding batch gap

An eighth original assertion submitted a version-1 batch with two `tables.set`
items. The first enabled all six switches; the second disabled first row and
vertical banding. Expected one publication and ordered persisted flags
`0,1,1,1,1,0`. Actual result was exit 2, `invalid-value`, with the public message
`Batch supports animation add, set and remove only.` The failed run had seven
passes and one failure. This validates an unsupported shared operation, not a
passing workflow. The positive assertion was replaced with an explicit rejection regression
checking the error envelope, zero publication calls and unchanged bytes. The
unsupported positive workflow is retained here for the assigned engine owner;
no unowned source was changed and no TODO was counted as a pass. Direct table
commands satisfy the shared operation routing requirement for these edits.

To reproduce, create an original 2x2 table and execute:

```text
pptx batch styles.pptx --ops-json '{"version":1,"operations":[{"operation":"tables.set","arguments":{"firstRow":true,"lastRow":true,"firstCol":true,"lastCol":true,"horzBand":true,"vertBand":true},"options":{"slide":1,"table":1}},{"operation":"tables.set","arguments":{"firstRow":false,"vertBand":false},"options":{"slide":1,"table":1}}]}' --in-place --json
```

## Renderer QA procedure

Not run. When an explicit independent renderer is available, use a disposable
copy selected from `docs/pptx/corpus-manifest.json`, toggle table style switches,
resize one column and compare table layout/rendering before and after. Retain
only findings and reduce a meaningful finding to small original regressions.
No corpus files belong in the package or unit suite. No screenshot is required
for this test-only addition because product output is unchanged.

## Final bounded text assertions

Four autofit settings (null, none, shape, text) map to absence or exactly one
noAutofit/spAutoFit/normAutofit node. Three wrapping settings (true, false, null)
map to square/none/absence. Each wrapping case checks all four original boundary
margins: left 0.1in, top 0.2in, right 0.3in, bottom 0.4in, serialized as
91440, 182880, 274320, 365760 EMU. SDK numeric margins are points (7.2, 14.4,
21.6, 28.8); the CLI performs explicit unit conversion. SDK shape selection uses
an explicit slide query with a one-based position, matching CLI `--slide 1`.

Two text assignment examples use new strings `bud` and `x\ny\nz`, preserving
the three-character and three-paragraph boundaries. Assignment replaces prior
paragraphs, unlike literal `text replace`. Both SDK operation and direct CLI
results agree; independent ZIP/XML assertions check exact paragraph counts and
run strings, and public text reading returns the intended content. These are
operation workflows, not claims about unexercised live TextFrame APIs.

Final focused command:
`node --import tsx --test packages/safe-bash/tests/commands/pptx/workflow-examples.test.ts`
passed 17 tests, zero failures/skips/TODOs, 1.675 seconds after the root's maintained
pptx build. Maintained discovery admits the new file. Formatter passed.
`npm run typecheck --workspace=virtual-bash` completed successfully: source and
tests plus 26 current consumer groups passed; three negative type fixtures
failed as expected. Receipt: `typecheck-passed-not-runtime-acceptance`, zero
builds/runtime executions, four held evidence inputs, cleanup complete.
`git diff --check` passed for the two owned files.

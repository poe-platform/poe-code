# Public table creation workflow

## Ownership and scope

The CLI worker owns the new `table-creation-workflow.test.ts` integration file
and this plan. SDK implementation belongs to the assigned table worker. Root
coordinates checks and local commit; no push, release or pipeline execution.
No product source, existing tests, README or downloaded assets are changed here.

## Original assertions

Two parameterized cases create a presentation with one original heading, then use public
`slide.shapes.add_table(2, 2, Length(3), Length(4), Length(9), Length(7))`.
Expect a live GraphicFrame with shape ID 3, two shapes total and four empty
cells. Integer remainder distribution is columns 5/4 and rows 4/3 EMU. Change
the last cell through its live model and save explicit bytes into memfs.

The second case preserves the expanded workflow boundary of 1in left, 2in top,
3in width and 1in height: explicit expected EMUs 914400/1828800/2743200/914400,
columns 1371600/1371600 and rows 457200/457200. Both cases assert `has_table`
on the returned model frame.

Execute a virtual script using direct `pptx tables add` with the same geometry
and original cell text, then `tables list`. Assert operation IDs and affected
counts. Independently inspect both the model and CLI saved ZIP payloads using
namespace-aware Saxes events: exact grid dimensions, four cells, enclosing box,
unique shape IDs 1/2/3 and original text. Reopen each output through the public
Presentation factory and verify its live table cells.

The model method and CLI deliberately accept different call shapes: typed Length
arguments and zero-based cell access versus explicit unit suffixes, one-based
slide/table selectors and a rectangular data grid. Both assert one independent
set of results; equality between implementations alone is not the oracle.

## Verification

Pre-build red check: `node --import tsx --test packages/safe-bash/tests/commands/pptx/table-creation-workflow.test.ts`
failed with `slide.shapes.add_table is not a function`, confirming the built
public method was absent. This agrees with the SDK worker's source TDD receipt.
Maintained safe-bash discovery includes the new file automatically. Final
focused result follows the root's maintained pptx build.

## QA status

Renderer QA not run. This change adds no CLI visual behavior. If checking visual
layout later, use an explicitly available independent renderer and disposable
fixtures listed in `docs/pptx/corpus-manifest.json`; retain findings, never those
binary inputs. These tests use only memfs and original text, not disk fixtures,
fonts, native runtime, product network or generated artwork.

## Focused result

After the root's maintained pptx workspace build, the same focused command
passed both parameterized cases, zero failures/skips/TODOs, in 0.527 seconds.
This proves paired model/CLI behavior and saved public model reopening; it does
not establish rendering fidelity. Formatter and owned `git diff --check` pass.
Final maintained safe-bash typecheck receipt follows below.

The maintained typecheck wrapper completed all 26 current consumer groups and
expected negative fixtures, but its initial source/test phase reported four
nullable geometry accessor errors in this new test. The assertion now uses
optional property access; absence still fails the exact numeric expectations.
The wrapper's source/test command, `node scripts/historical-type-models.mjs --noEmit`
from `packages/safe-bash`, was rerun after that correction and passed. All other
wrapper phases passed unchanged; this is a repaired source-phase receipt, not
a claim that the earlier wrapper invocation passed. The focused runtime check
was repeated after correction and passed 2/2 in 0.740 seconds.

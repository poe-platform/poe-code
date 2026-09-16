# Positive table dimension boundaries through SDK and CLI

## Ownership

The CLI worker owns only the new `table-dimension-boundaries.test.ts` and this
plan. Table source belongs to the assigned SDK owner; root coordinates checks
and local commit. No push, release, whole pipeline, README edits or fixtures.

## Original cases

Six independent parameter rows target §6.3's positive geometry requirement:

- Creating 2x2 with total width 1 EMU or height 1 EMU.
- Explicit cell row height zero or column width zero.
- Resizing an existing 2x2 table to total width 1 EMU or height 1 EMU.

The valid starting grid is 2x2 at 2x2 EMU, giving each cell one positive EMU.
Original cell labels and a five-byte preexisting destination live only in memfs.
Each case checks public SDK `invalid-value`, immutable caller input bytes,
direct CLI exit 2/error envelope/affected zero and zero publication calls. Both
in-place and explicit forced output destinations preserve their prior bytes.
These mutations do not justify rejecting unrelated edits to imported zero-sized
cells; preservation is separately verified by the SDK owner.

## TDD evidence

Before the fix, all six SDK assertions failed with `Missing expected rejection`.
The same tests reordered to check CLI first then failed all six with exit 0
rather than 2; their JSON reported success and affected 1, proving publication
of the invalid dimensions. The tests now retain CLI-first then SDK assertions.
No fixture or test dependency was changed to conceal these failures.

Command:
`node --import tsx --test packages/safe-bash/tests/commands/pptx/table-dimension-boundaries.test.ts`

Final verification follows the root's maintained pptx build with the SDK fix.

## QA

No renderer run; these are data admission and publication assertions. No visual
CLI language is changed by this integration test. Any later rendering QA uses
explicit independent tools and disposable corpus-manifest inputs; unit tests
remain entirely original and memory-backed.

## Final verification

After the root's maintained pptx closure rebuild, the focused four-file command
passed 30 tests, zero failures/skips/TODOs, in 1.341 seconds:

```text
node --import tsx --test packages/safe-bash/tests/commands/pptx/table-dimension-boundaries.test.ts packages/safe-bash/tests/commands/pptx/table-creation-workflow.test.ts packages/safe-bash/tests/commands/pptx/workflow-examples.test.ts packages/safe-bash/tests/commands/pptx/tables.test.ts
```

This includes all six new rejection cases, two public creation workflows,
17 earlier table/text workflows and five existing table integration tests.
The new test is automatically admitted by maintained discovery. The maintained
source/test type phase `node scripts/historical-type-models.mjs --noEmit` from
`packages/safe-bash` passed. Earlier unchanged consumer-phase receipts remain
separate; no whole runtime suite was executed. Formatter and owned diff checks
pass. Root handles the required CLI error screenshot and its visual inspection.

## CLI visual inspection

Used the maintained `npm run screenshot -- --output /tmp/pptx-table-dimension-errors.png
--no-header node --import tsx --input-type=module -e ...` route with an inline
public engine/Shell driver and a MemoryFileSystem deck. Inspected the resulting
PNG: the 2x2 creation with width 1emu reports the bounded positive-size error and
exit 2; width 2emu validates one table and exits 0. Both commands use height 4emu
and dry-run. Text is complete, readable and unclipped. This is CLI error/success
inspection, not presentation rendering. Artifact SHA-256:
`6979a5367fa2742834d70fa30a947984d41b26931848668189e43a55659f97c8`.
The PNG remains a disposable local artifact and is not committed.

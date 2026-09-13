# PPTX public closure verification evidence

This receipt describes local checks on the current working tree, not full API
coverage, remote delivery or a release. The [agent procedure](../plans/pptx-public-closure-verification.md) records scope and ownership.

## Executed baseline

- `npm run test --workspace=pptx`: 261 files, 6,838 tests passed (76.48 seconds).
- `npm run lint --workspace=pptx`: passed.
- `npm run build:workspaces -- --workspace=pptx`: passed selected dependency closure.
- `node --import tsx --test packages/safe-bash/tests/commands/pptx/*.test.ts`:
  239 tests passed, zero failures/skips/cancellations (9.078 seconds).
- Built public `import * as sdk from 'pptx'` exposed 272 runtime bindings. Original
  no-argument creation, save and reopening succeeded (4,083-byte empty deck).
  Its model lacked `slide_layouts`, `slide_masters`, and `slides.add_slide`.
  These are confirmed missing APIs, not a complete list of missing behavior.

The baseline predates the new original guide regressions and domain fixes; final
verification must qualify the resulting candidate separately. No screenshots or
renderer/playback claims follow from structural tests. Existing CLI output is
unchanged by the package ownership work.

## Integrated candidate

The combined maintained package run passed 268 files and 6,871 tests in 60.45
seconds. That run included four run-hyperlink cases. A final refinement replaced
the detached-run generic error with the specified `PropertyAccessError` and removed
unused save authority from the private link session. Its five focused cases plus
the eleven guide cases passed afterward (16 tests, 2.15 seconds); these overlap
the package suite and must not be added to its count as distinct coverage.

After that refinement, `npm run lint --workspace=pptx` and the maintained selected
PPTX build closure both passed. The rebuilt safe-bash PPTX command-family tests
passed all 239 cases, with zero failures, cancellations or skips (8.965 seconds).
No safe-bash source files were changed by this task.

A standalone Node consumer imported the built public `pptx` package, created an
original presentation, selected its owned layout, synchronously added a slide,
inserted a textbox and chart, assigned font RGB and a run hyperlink, saved and
reopened it. It observed 274 runtime exports, one layout, one slide, two shapes,
a 7,159-byte package, preserved hyperlink metadata and shared shape/slide part
identity. This exercises built exports, not a published or packed-consumer release.

The guide receipt retains all 74 snippet and 83 heading identities. The API
register retains all 2,409 inventory records and 2,426 target rows: 749 have
bounded receipts, 8 are confirmed unsupported, and 1,669 await current
reconciliation. These categories are not a full-member pass percentage. Bounded
receipts do not certify every historical planned case or CLI metadata operation;
unsupported members and rows awaiting reconciliation still block full coverage.
Master/notes owner graphs, other run-hyperlink owners, grouped chart insertion
and exact remaining guide/command pairings remain visible obligations.

Original tests use authored small data and explicit memory capabilities. No
publisher deck, downloaded document or cloned binary was used, changed, shipped
or deleted. There is no independent renderer/playback or screenshot claim; these
changes do not alter CLI output styling. README and unrelated working-tree
changes remain outside the owned commits. Delivery is local on main only.

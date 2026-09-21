# Independent PDF clipping stress QA

Run by a different agent from the PDF implementation owner on 2026-09-21.
Root retains export, integration and Git ownership. No native utilities were
spawned by unit tests; fixtures are original in-memory Gnumeric XML. No files
are written by the new unit tests.

## Candidate and procedure

Dirty workspace based on `b97c4938a469ee70e09bd08a0e5fcf7e868ca04c`; this is
not a committed-revision qualification.

- `packages/ssconvert/src/codecs/pdf.ts` SHA-256:
  `f002dd3b9f9dfc450950fe9e696abce73510d6d3be6eafcf954eb9a2a0ab1c8f`.
- `packages/ssconvert/src/codecs/pdf-clipping-stress.test.ts` SHA-256:
  `5035d9c89dd899fe4292c4e9c629524137d004bd75a02fbcf77e94854484d318`.

Execute these commands from the root, inspect failures, and distinguish this
focused run from root-wide gates:

1. `npx vitest run packages/ssconvert/src/codecs/pdf-clipping-stress.test.ts`
2. `npm run lint --workspace=@poe-code/ssconvert`
3. `node --import tsx --test packages/safe-bash/tests/commands/ssconvert-pdf.test.ts`

Inspect decoded content streams to independently calculate cell anchors and
Cartesian page order. Check graphics-state balance, clip geometry, and retained
scene transforms. These checks do not establish native rendering parity.

## Results

Seven independent stress cases passed, with no skipped cases:

- A 600-by-700-point filled graph survives all four Cartesian pages, with
  independently calculated positions, page-cell clips and balanced `q`/`Q`.
- A C3 anchor with half-column and quarter-row offsets retains its exact
  point position when crossing a horizontal page boundary.
- A J1 graph merely touching the first page is painted only on the second.
- A graph ending exactly at the 432-by-599.25-point cell page boundary
  does not create an extra page.
- Absolute objects spanning pages fail with unsupported-feature/status 1.
- An extreme object extent exceeds a deliberately tiny work budget before
  graph painting, with resource-limit/status 1.
- Cancellation during graph painting preserves the caller's reason and
  restores the enclosing clip graphics state before rejecting.

The maintained ssconvert workspace lint route passed (ESLint, source and test
TypeScript checks). Existing Safe Bash PDF integration passed: public SDK and
virtual CLI bytes, first-object fit dimensions, repeated execution output bytes,
missing-object diagnostic/status and unchanged memfs namespace controls.

The first stress execution had one harness assertion failure: pdf-lib represents
a rectangle as a translated polygon rather than a `re` instruction. The test
was corrected to inspect its transform and polygon; this was not a validated
product defect. No product source changes were made by this agent.

## Limits and remaining cells

This agent did not execute a native oracle, rendered-page screenshot comparison,
checkpoint restoration, separate-realm execution, host filesystem adapter,
release/build gate, broad test suite or performance measurement. Those cells
remain unverified by this stress run. The replay integration uses repeated shell
execution, not checkpoint/replay serialization. Unsupported absolute spanning
objects are rejection coverage, not preservation passes. Native metadata,
pagination parity, font/layout parity, graph-series support and persisted print
settings are outside this bounded review; root's separate evidence is required.

## Persisted-print successor review

The implementation owner subsequently added retained print settings. The earlier
PDF source hash above does not qualify that successor. On the same dirty base,
the successor reviewed here has these SHA-256 hashes:

- `src/codecs/pdf.ts`:
  `731ac9bed5f69cc58d8962c5dd478f85613468a2b11981dfa20c2b0daf5002ee`.
- `src/rendering/print/settings.ts`:
  `0e0bc671e2c1eec09a90591588285e4b1ffe67af3bcb9f96b696f9f5d7c7bf6d`.
- `src/codecs/pdf-print-independent.test.ts`:
  `ec793df8a6bcc2ec6648e166517dee5067f5d168d582b23039dd25309eba7871`.

Run `npx vitest run packages/ssconvert/src/codecs/pdf-print-independent.test.ts
packages/ssconvert/src/codecs/pdf-clipping-stress.test.ts` as one shell line.
Twenty-one cases passed: all seven earlier clipping cases and fourteen new
persisted-print cases. No cases were skipped. New coverage includes:

- Foreign element and qualified attribute namespaces cannot supply paper,
  orientation or percentage settings.
- The 50% body CTM preserves the top-left point and follows unscaled header and
  footer text; fit-to-one-page produces a positive isotropic body scale.
- Asymmetric margins position left, middle and right header fields using the
  available printable width; margins with no header/footer room suppress them.
- Down-then-right and right-then-down preserve all four corner texts and their
  independently expected Cartesian page order.
- The initial candidate's `do_not_print` test expected exclusion even when
  explicitly selected. Further source tracing invalidated that expectation;
  this is not a native compatibility pass (see repairs below).
- Enabled titles, grid, draft and monochrome fail explicitly without a painter.
- Center flag value 2 remains disabled, matching value 0.

Two initial hypotheses were corrected without product edits. Empty header/footer
fields still emit empty PDF text operations, so body-only scaling checks count
nonempty strings. The centering reader stores an integer in a gboolean, which
initially suggested any nonzero value should center. Exact released-source
tracing through `src/print.c` lines 606, 610 and 612 instead proves that the painter
explicitly checks `== 1`; the negative controls were corrected to preserve that
native quirk. Neither hypothesis is a validated product defect.

These tests inspect semantic geometry/content deterministically; their run times
under concurrent workspace load are not a performance qualification. This
successor review does not measure native fit scaling, native header/footer
positioning, comments, manual breaks, repeat ranges, RTL, malformed numeric
profiles, external fonts, checkpoint serialization or cross-realm bindings.
Unsupported flags are rejection checks, not feature preservation passes. Root
owns separate native differential evidence and the required build/gates.

## Source-backed selection and paper repairs

Root traced released `print-info.c` workbook export selection: explicit chosen
sheets override retained `do_not_print`, but hidden sheets stay excluded by the
all-sheets print mode. Root also traced explicit export paper overriding each
sheet's retained paper. Independent failing cases reproduced three issues:

1. Unknown retained paper prevented an explicit qualified `paper=A4` export.
2. Retained `do_not_print` suppressed an explicitly selected sheet.
3. Explicit selection printed a hidden sheet.

With root's specific ownership grant, this agent repaired only the three
corresponding conditions in `pdf.ts`. Regression coverage includes both CLI
export-option and SDK selection; implicit `do_not_print`, unknown retained paper
without an explicit override, and an explicitly empty SDK selection remain
negative controls. No other product files were edited by this agent.

The immediate combined run had 24 passes and one failure out of 25, with zero
skips. The failure independently demonstrates a fourth issue: a two-sheet
workbook's `&[PAGES]` headers use a per-sheet total instead of the global total.
Root owns that repair and the subsequent candidate qualification. This partial
run is not a complete passing gate. Earlier lint passed before these repairs;
it does not qualify the repaired source.

## Frozen product candidate verification

Root repaired global page totals by precomputing selected sheet layouts before
painting. The independently rerun frozen product identities are:

- `src/codecs/pdf.ts`:
  `dee8d3edef0d2ac5e25e07965c946508f8604df0fa6e0b811b082877de4bdc86`.
- `src/rendering/print/settings.ts`:
  `0e0bc671e2c1eec09a90591588285e4b1ffe67af3bcb9f96b696f9f5d7c7bf6d`.
- `src/codecs/pdf-print-independent.test.ts`:
  `f482571084e6d4022be1d738e261fc7f6948c142f8bae6cc105cdc528ba1e90d`.
- `src/codecs/pdf-clipping-stress.test.ts`:
  `5035d9c89dd899fe4292c4e9c629524137d004bd75a02fbcf77e94854484d318`.

The earlier 25 cases all passed against the frozen product hash. Two additional
precomputation negative controls also passed: an excessive later sheet exceeds
its work limit before painting or formatting any sheet, and an already aborted
signal preserves arbitrary caller reason identity without painting. The final
focused run therefore passed 27 of 27 cases (20 print and 7 clipping), zero
failures, zero skips. No product changes followed that run by this agent.
The maintained `npm run lint --workspace=@poe-code/ssconvert` route also passed
against these final identities, covering ESLint plus source/test TypeScript.

Precomputation calls signal/work ticks while scanning sheets, object extents and
page layouts, and admits each layout's Cartesian product before allocation. It
retains layouts to compute the workbook total, then charges page counts against
the shared writer work counter before painting. This review does not establish
an exact peak-memory cap: local layout limits and aggregate writer accounting
are separate, and the aggregate page charge follows each local layout allocation.
Signal polling in synchronous layout work is cooperative; it does not permit a
timer event to interrupt the JavaScript turn. Pre-abort and paint-time
cancellation tests are deterministic controls, not arbitrary host preemption
or bounded cancellation-latency guarantees.

Root's separately owned full workspace gate initially had an expensive quantile
test timeout under contention and an intermediate-source paper expectation.
Root is investigating and rerunning that broad gate. This document's focused
pass does not replace it or mark an incomplete broad run successful. Build,
SDK/checkpoint/replay and native differential verification remain root-owned.

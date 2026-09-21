# Sheet selection and range: exact-candidate follow-up

Verified September 19, 2026 on Node v22.22.2 / npm 10.9.7, working tree based
on `b97c4938a469ee70e09bd08a0e5fcf7e868ca04c`. Existing edits and the existing
sheet-selection implementation were preserved. No README, manifest, public
export or product integration source was changed by this follow-up. No commits,
push, publication or release were performed.

## Validated fix

Authenticated the retained official Gnumeric 1.12.61 archive against SHA-256
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12` and
extracted primary source only into task-owned `out`.
`parse-util.c:1180` copies singleton endpoints, and `position.c:707` evaluates
each endpoint against its respective sheet dimensions before normalizing.
`ssconvert.c:1241` then uses those normalized coordinates through the active view
for updates. These primary contracts independently establish the fix's expected
results; they are not fresh native observations.

The original failing regression showed `First:'A= B'!DY129`, spanning a
256-by-256 sheet and a 128-by-128 sheet, incorrectly returning `128,128:128,128`.
The shared parser now returns `0,0:128,128`. Absolute `$DY$129` remains
`128,128:128,128`; relative whole columns `DY:EZ` return `0,27:127,128`.
Normalization occurs before endpoint sorting and preserves the original sheet
span order. The command and SDK use this same parser, including `--set`.

## Candidate identity

The sorted manifest of 104 files covers all ssconvert source/scripts, its
package/TypeScript configuration, the Safe Bash ssconvert command source and
integration test, and root/Safe Bash manifests. Its SHA-256 over compact JSON
`[{"path":...,"sha256":...},...]` is
`3dc1649f0cf4b0add112c9b851ab7ed6bb6502a6ca817e3b9303f8c7eed6a4c6`.
This identifies a working-tree candidate, not a committed or delivered revision.

| Changed code/test | SHA-256 |
| --- | --- |
| `packages/ssconvert/src/workbook/expressions.ts` | `42cb92ef4fc71fd0a511d34c1edc3e6604a6908291bf9974c453bd61006d6346` |
| `packages/ssconvert/src/workbook/range-selection.test.ts` | `dc33b014cd59651c2c6790cbbed11591d26ba92802c81849dd3b741ed9ca5a38` |
| `packages/ssconvert/src/conversion/sheet-span-followup-independent.test.ts` | `48bf19b1dff56c849fe764e28413036bdb826e55b9ed63c82acd2797bd714bd9` |
| `packages/safe-bash/tests/commands/ssconvert.test.ts` | `c0d7183d177978bdbdc522a5c023390de18e226a5a55f090442ebf5f9b08eff5` |

## Passes

- Before implementation: new regression failed concretely with wrong singleton
  bounds; existing three tests passed. After implementation all four passed.
- `npm run test --workspace=@poe-code/ssconvert -- --no-cache`: final 38 files,
  557 tests passed; no skips. This includes existing selection, grammar,
  ownership, injected I/O, authority, cleanup and resource-limit suites.
- `npm run lint --workspace=@poe-code/ssconvert`: final maintained ESLint and
  production/test TypeScript checks passed with zero warnings, independently
  executed by the stress agent after its test file settled.
- `npm run build:workspaces -- --workspace=@poe-platform/safe-bash --no-cache`:
  all 18 maintained dependency-closure builds passed, including ssconvert and
  Safe Bash, with native npm postbuild stages. Parser source remained unchanged
  after this build; the stress agent added only tests.
- `TSX_DISABLE_CACHE=1 node --import tsx --test
  packages/safe-bash/tests/commands/ssconvert.test.ts`: final 23 tests passed;
  zero failures, cancellations or skips. Actual shell invocation covers the
  qualified span's export bounds, active-view update bounds and trailing-text
  diagnostics while preserving destination bytes. Scoped integration-file
  ESLint passed from the Safe Bash workspace.
- A different agent independently checked primary source and added 36 holdouts:
  11 span variants through SDK/CLI, those variants through `--set`, eight invalid
  cases through export/update paths, cancellation before input and during
  encoding, cleanup, output bytes, and three realm/accessor boundary controls.
  No further parser defect was validated. Fixtures are original, small and
  deterministic; there is no random seed. Unit file effects use memfs, with no
  native utility spawn, LLM query or host-file write.
- Executed the Markdown [QA procedure](../plans/ssconvert-sheet-span-followup-qa.md).
  Six manual actual virtual-command cases produced the expected range output,
  status and diagnostics. The existing destination retained `keep`. Inspected
  the rendered terminal screenshot: all output and diagnostics were readable
  and unclipped. Screenshot SHA-256 before owned scratch cleanup:
  `e79f65cc38c23de08609ee027631d00789902cc1318423096f9981a3deb6033c`.

## Failures and unsupported cells

- The maintained `npm run typecheck --workspace=@poe-platform/safe-bash` failed
  with exit 2 before consumer/source compilation. Investigation traced its
  canonical SafeFS prerequisite to the absent root `./safe-fs` export: actual
  `undefined`, expected `./packages/safe-js/dist/safe-fs.js`. The root manifest
  already has unrelated working-tree edits, which were preserved; no prerequisite
  was weakened. This broad consumer gate remains failed, despite the passing
  selected build and focused runtime checks.
- An exploratory positive test for ordinary `node:vm` workbook objects failed
  with the existing `Unsupported workbook prototype` boundary. Source inspection
  confirmed explicit admission of same-realm or null-prototype records. Ordinary
  foreign object input remains unsupported, not a compatibility pass. The final
  negative control asserts exact SDK/CLI rejection, zero getter execution and no
  export/publication. Foreign null-prototype records with foreign arrays passed
  SDK/CLI range execution without mutating the provider's original data.

## Unverified, skipped and remaining mismatches

The existing [captured reference profile](sheet-selection-and-range-profile.json)
and [compatibility report](sheet-selection-and-range-verification.md) are retained
as earlier evidence, not freshly rerun passes. Docker's Colima socket was located,
but the task's captured oracle container/binary had been removed. No native
fallback, ambient workbook lookup or product dependency was introduced.
Fresh native runtime differential cells, other Node versions and browser/Worker
hosts remain unverified in this follow-up.

Every earlier recorded limitation remains: error-sheet `First!#REF!` diagnostic
and stage mismatch; C-locale non-ASCII argv transcoding; external simultaneously
loaded workbook namespaces; arbitrary custom exporter-option callbacks;
complete native-format serialization, hidden-axis/merged/sparse rendering,
optional plugins and native file modes; and NUL argv differential coverage.
The earlier profile contains hidden/sparse/merged observations, selection order,
save-scope checks and merge-before-input ordering; this follow-up's retained unit
cohort verifies engine contracts, without newly qualifying native serializer bytes.

The engine exposes no persistent checkpoint/replay execution API, and no such
route was added or affected. Original SDK, CLI and virtual-shell execution were
verified; checkpoint/replay cells remain unverified rather than passes. No bounded
performance study was performed; test durations are not performance guarantees.
Repository-wide `npm test`, lint and root build were not run: this change is a
single-package parser fix plus focused integration tests, covered by the selected
cross-workspace dependency closure. No workflow change or workflow check was
needed. There were no timeouts or incomplete focused test/build/lint runs.

Owned extraction, logs, generated manifest and screenshot are purged only after
reducing their findings here. Unrelated `out` content is preserved.

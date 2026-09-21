# Current MPS and model export verification

This recheck preserves the existing TypeScript ESM `packages/ssconvert` engine,
declarative providers, SDK and opt-in safe-bash virtual command. It repairs two
validated gaps: CR-only MPS line endings, and solver target interpretation for
literal, multi-cell, missing-cell and named XML targets. Model exports require
neither a solver capability nor glpsol/lpsolve. No README edits, commits, pushes
or publication were performed.

The existing official archive under `out/ssconvert-lifecycle` was authenticated
again against SHA-256
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
Reference dependency/plugin/locale capture remains in
`mps-model-reference-profile.json`. Primary source stays under `out`; the native
Gnumeric 1.12.61 Linux/aarch64 container is a separate QA oracle. Product checks
run on Darwin/arm64 with Node 22.22.2. Other product OS/Node cells are unverified.

## Differential cases and negative controls

Before the importer edit, an original in-memory CR-only regression failed:
candidate objective `0` with two bounds versus native `2 X_1` with one bound.
Native conversion exited 0 without diagnostics. CRLF was a passing negative
control and remains passing. The importer now scans CR, LF and CRLF boundaries
without regexes; comments and blank lines retain their existing semantics.

A different agent reproduced target differences with failing regressions, then
repaired them. Numeric targets, multi-cell ranges, missing target cells outside
inputs and deferred XML target names export native objective `0`. A singleton
range still resolves its cell; an absent target inside Inputs is allocated and
sampled as a variable. Local/global name shadow fixtures pass through XML
import and both exporters. Independent manual procedure, failures, repairs and
unverified cases are in
`../plans/ssconvert-mps-current-stress-qa.md`.

Memfs command checks now cover original MPS input, XML checkpoint, replay and
SDK byte identity for both exporters. They assert exact diagnostics/statuses,
unchanged original/neighbor files and the complete output namespace. The existing
focused cases cover malformed imports, non-LP empty-file publication, invalid
variable sets, constraint geometry, bounds/integer/binary ordering, polynomial
sampling quirks, output/work budgets, pre-cancellation and workbook immutability.
Unit tests do not spawn native utilities, write host files or query LLMs.

## Candidate identity

The candidate is a dirty-worktree overlay on main
`b97c4938a469ee70e09bd08a0e5fcf7e868ca04c`; it is not a new committed revision.
Final SHA-256 identities bind the checked task sources and tests:

| File | SHA-256 |
| --- | --- |
| `packages/ssconvert/src/codecs/mps.ts` | `a32200942caad9b027563803085beb16b205e5fbed4e7ff62b1a861428e5cac5` |
| `packages/ssconvert/src/codecs/model-program.ts` | `5e023d0d084e94e4b264aa21f14b31c32168cdaa3082b0fff8848432f01b5c18` |
| `packages/ssconvert/src/codecs/model-program.test.ts` | `c4e1b97c8fd6e6a3a0a88e9ec406c260e9e3ac95c88276a389523ec6069f7e8c` |
| `packages/ssconvert/src/codecs/model-program-independent.test.ts` | `934d087d57b5a1ff71290643b7a12b9f1b957626bd6f71a8eb2cf3ed084354d8` |
| `packages/safe-bash/tests/commands/ssconvert-model.test.ts` | `2efdd498f6be30ae3df8c1e47cfff7eecbae645ed9ed7cdb00cb7d58ed251661` |

## Final gate accounting

| Gate | Result |
| --- | --- |
| `npm run build:workspaces -- --workspace=@poe-code/ssconvert --no-cache` | Passed selected maintained build dependency closure after final product edit |
| `npm test --workspace=@poe-code/ssconvert` | Passed final fixture revision: 229 files, 5,247 tests; fresh execution |
| `npm run lint --workspace=@poe-code/ssconvert` | Passed ESLint and source/test TypeScript after readonly fixture repair |
| `node --import tsx --test --test-concurrency=1 packages/safe-bash/tests/commands/ssconvert*.test.ts` | Passed 81 command tests, zero failures/cancellations/skips |
| Focused ESLint on `packages/safe-bash/tests/commands/ssconvert-model.test.ts` | Passed |
| Maintained root `npm run lint:types` | Passed after final product edit, including declared contract checks; root uses its maintained incremental type cache |
| Independent final focused recheck | Passed 51/51 after fixture repair |
| Manual virtual-command screenshot | Captured using `npm run screenshot -- --no-header -o out/...`; inspected objective, constraint, bounds and End as readable and complete |

Inspected readable screenshot SHA-256:
`d0d223b39fd3cbeddea70c8ed95cf7d46d39d1b07d4cd5517ab5bb2d59137555`.
The initial screenshot's long harness header made output too small; it was
recaptured without that header. Both commands exited 0.

Failures investigated: initial CR regression and independent target regressions
reproduced native differences before repair. The first workspace lint exited 2
on a readonly assignment in the new independent test fixture; reconstructing
the fixture immutably fixed it. The final full package test and lint runs passed
after that edit. No timeout or incomplete started gate occurred in this cohort.

Skipped broader gates: full safe-bash tests, root `npm test`, repository-wide
ESLint/workflow lint and root `npm run build` were not run. This cohort changes
focused ssconvert algorithms and one integration test; it does not change shared
infrastructure, providers, package exports, workflows or the command adapter.
The integration check is focused, not a completed broad gate. Historical checks
in `mps-model-verification.md` are separate evidence, not current gate passes.
No unavailable matrix cell or known mismatch is counted as passing.

Task-owned scratch logs, original fixtures and screenshots under
`out/ssconvert-mps-current` were removed after evidence reduction. Existing source
archives, oracle directories and the oracle container remain unchanged.

## Remaining mismatches and unavailable coverage

Retain all limitations in `mps-model-verification.md`: native timestamped/PID
GLib equality-range and unknown-section warning bytes are not emulated; invalid
problem direction 4 crashes native but defaults to minimization here; full
workbook style/XML serialization, exhaustive malformed records, locale/encoding,
float rendering ties and every solver formula are not certified.

The independent cohort also observed native acceptance of global-name position
`Sheet1!A1`, while the existing XML importer reports `Invalid A1 address`.
This remains an unresolved XML compatibility mismatch. Its minimized fixture
uses the documented local/global Goal case with that position instead of `A1`.
This case is not counted as passing and was not silently repaired outside the
model algorithms.

No isolated realm/worker matrix, host-sink mid-write cancellation, large-model
performance, optional solver execution, recursive/input-scope names, legacy
TargetRow/TargetCol, 3-D ranges or cross-sheet LP name collision matrix was run.
Standard engine injection and memfs command checks establish measured byte/file
effects, not a new host isolation or arbitrary rollback guarantee. Existing
cleanup/authority contracts were unchanged. No mathematical solver-success or
full exporter-parity claim is made.

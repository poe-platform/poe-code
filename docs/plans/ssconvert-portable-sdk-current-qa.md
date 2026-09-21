# Portable SDK current-candidate verification

## Manual procedure

1. Preserve the existing worktree, including previous public SDK work. Authenticate the retained primary archive in `out/ssconvert-lifecycle` against SHA-256 `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`. Inspect the captured dependency/plugin/locale profile in `docs/ssconvert/reference-profile.json`. Native utilities remain separate QA oracles.
2. Before implementation, execute `src/public-xlsx-boundary.test.ts`: both writer editions must reject duplicate addresses, preserve pre-await caller data and reject accessors without execution. Record actual failures before fixing. Use the shared workbook snapshot validator, rather than duplicating validation in the public codec.
3. Run the uncached selected ssconvert build and maintained package tests/lint. Compile the persistent published-consumer fixture with strict NodeNext declarations; run its package/root public imports with normal and browser conditions, then bundle for a browser. Browser conditions on Node and successful bundling do not establish real-browser execution.
4. Execute maintained safe-bash ssconvert command files with the package's Node test runner. Manually invoke the public virtual command against an original in-memory workbook, then reopen its XLSX bytes through the public SDK. Check output, status and namespace contents. Check missing-capability rejection and absence of accidental destination creation.
5. After implementation, a different agent independently stresses/fixes the boundary using distinct controls. Root retains runtime/export/integration/Git ownership. Run final focused tests and maintained lint after independent changes.
6. Execute repository-wide `npm test -- --no-cache`, `npm run lint`, and `TURBO_FORCE=true npm run build` for the wider public integration contract. Investigate failures without replacing existing changes. A stopped or failed broad gate remains incomplete/failed even if focused checks pass.
7. Identify the exact candidate with the base Git revision and SHA-256 of changed runtime/tests. Keep logs/generated artifacts in `out` during verification, then purge only this task's temporary files after recording results.
8. Capture the actual public virtual command's help through the retained explicit in-memory visual host with `npm run screenshot -- --output out/ssconvert-portable-current-help.png --no-header node out/ssconvert-lifecycle/visual-host.mjs 'ssconvert --help'`. Inspect the image; this is ad hoc QA, not a screenshot unit test. The host's final Files line is evidence of its in-memory namespace, not ssconvert help output.

## Feature mapping and matrix

The full CLI/SDK mapping is preserved in [the existing contract procedure](ssconvert-portable-sdk-and-pandoc-contract-qa.md). It covers import/export IDs, ordered options, encoding, conversion/merge, sheet/range/split, graph/resolution, updates, recalc/resize, clipboard, goal seek, solver/analysis, registry/help metadata and explicit runtime/environment controls. Existing request-field census guards new SDK conversion controls at compile time; it does not establish native parity for each mapped field.

Required cells are reported individually: compiled NodeNext consumer, root/package import identity, browser bundle, real browser runtime, injected I/O, cancellation and budgets, shared command/SDK engine, independent review, native reference/profile and optional upstream runtime variants. Original/checkpoint/replay execution is unmeasured unless an executed case explicitly establishes it. No fallback, private-path consumer import or implicit host I/O is authorized. Pandoc's separately blocked gate remains outside this task.

## Results

### Reproduction and repair

Before implementation, all four original boundary regressions failed: both editions accepted duplicate addresses, retained mutable caller data across package awaits, and executed workbook accessors. The public writer now snapshots/validates the workbook synchronously. The first maintained package run then exposed four diagnostic regressions: malformed coordinates changed from the established codec `unsupported-feature` diagnostic to workbook `invalid-request`. Bounded descriptor-only coordinate admission preserves the original error/status and never executes accessors; its work is charged to the writer budget. Existing tests were preserved.

### Verified passes

- Required primary archive SHA-256 matches exactly; existing dependency/plugin/locale provenance remains captured in the reference profile.
- Final `npm run build:workspaces -- --workspace=@poe-code/ssconvert --no-cache`: passed the declaration-derived four-build dependency closure.
- Final `npm run test --workspace=@poe-code/ssconvert -- --no-cache`: 308 files / 6,206 tests passed, no failures/skips. Earlier failing package execution is recorded above, not counted as passing.
- Independent current-candidate review: nine distinct accessor/sparse-array/budget/cancellation/ownership/host-authority tests passed; maintained package lint (ESLint, runtime/test TypeScript and strict compiled-consumer declarations) passed. See [independent procedure](ssconvert-portable-sdk-current-independent-qa.md).
- Maintained safe-bash command files: 112 passed, zero failures/skips/TODOs. Existing original/checkpoint/replay cases are included for analysis, clipboard and other command operations; this is scoped integration evidence, not full shell replay certification.
- Final strict NodeNext public-consumer compile (`skipLibCheck: false`, no ambient Node types), compiled package/root consumer execution, browser-condition consumer execution, and browser bundling passed. Browser bundle is approximately 6.5 MB; this is a measured artifact size, not a performance or tree-shaking guarantee.
- Manual public virtual-command CSV-to-XLSX conversion and public reader reopening passed; unknown exporter returned status 1 and created no destination. Original and sentinel resources remained unchanged. Initial manual invocation mistakenly supplied the CSV exporter ID as importer; the engine correctly rejected it. Retrying with the registered `Gnumeric_stf:stf_csvtab` importer passed without a code change.
- Bundled consumer execution in a separate VM realm without `process`, `Buffer`, `require` or admitted module imports passed. This measures the pure-JS XLSX path; it does not prove arbitrary injected host safety or a real browser runtime.
- Actual virtual command help screenshot captured and inspected: aligned option descriptions, readable output, no clipping. The preexisting in-memory visual host resolves public compiled imports; no QA script was added.

### Candidate identity

Base Git revision: `b97c4938a469ee70e09bd08a0e5fcf7e868ca04c`. Existing worktree changes are preserved; this is not a committed revision.

Aggregate current-candidate SHA-256: `7c28a9e4038dafa27a8954a838b087398ed12bef2a74524528796960c6fdab80`. The digest covers all 595 regular files recursively under ssconvert `src`, `tests`, `scripts`, its package manifest and three tsconfigs, the safe-bash ssconvert adapter and package manifest, and root package manifest. Sort relative paths lexically; hash each UTF-8 path, NUL, raw file bytes, NUL. This includes existing work without claiming its authorship. Shared dependency implementations and all optional host/runtime cells are outside this aggregate identity.

| File | SHA-256 |
| --- | --- |
| `packages/ssconvert/src/codecs/xlsx.ts` | `7ce7554ce066a10436626cf8fdac78319134f2d5cccf3297b56d26233f9e5e12` |
| `packages/ssconvert/src/public-xlsx-boundary.test.ts` | `af3d0a3f0d36ecef984328f2248ab200edca74d002e5e29f605133318383987b` |
| `packages/ssconvert/src/public-xlsx-current-independent.test.ts` | `1f357ecd613055fb7d934e2e1a5ecb9721b97015e5397b830372b0809b3e1d67` |

### Unsupported and unverified cells

No new native differential cohort is counted. The retained `colima`/`ssconvert-statistics-qa` container is running, but attempting the captured `/opt/ssconvert-reference/bin/ssconvert` binary returned not found; its captured runtime hash/profile cannot be requalified by this invocation. No native installation, fallback or unrelated container cleanup was attempted.

Real-browser execution, every upstream optional dependency/plugin/locale variant, all exporter option combinations and graph/image backends remain unverified by this task. Existing per-feature mismatch/coverage registers and optional runtime profile blockers remain unchanged; source census and injected capability APIs do not establish native implementation parity. The previously documented Pandoc gate remains separately blocked and was not changed or counted as passing.

No visible CLI output was changed: coordinate diagnostics are preserved and command/listing suites passed. No README, Pandoc source/gate, Git commit, push, publication or release was changed.

### Repository-wide gates

- `TURBO_FORCE=true npm run build`: passed the uncached declaration-derived 84-workspace-build closure and normal root suffix/codegen/TypeScript/bundle stages. The manifestless/no-declared-build entries in the maintained runner receipt are not build passes.
- Final `npm run lint`: passed exit 0, including ESLint, root/contract declarations and workflow lint. The ESLint receipt is complete with 17,039 configured subjects linted, zero errors, four unrelated warnings and zero gaps. Unconfigured/ignored subjects and five held excluded roots are not lint passes.
- Initial broad lint returned exit 2 because four ancestor filesystem-identity checks observed root directory size drift while the concurrent root build replaced `dist`. Its receipt had zero lint errors but was incomplete. The final stable-output rerun above completed; no guard, historical fixture or lint assertion was weakened. Separate fresh `npm run lint:types` and `npm run lint:workflows` also passed after the original chain stopped.
- Initial `npm test -- --no-cache` failed a five-second regression-analysis timeout in `analysis/statistical-current-independent.test.ts` (a test imported from `moments.test.ts`) under concurrent build/lint load. Investigation reran the complete 40-test file under reduced load: 40 passed, 610 ms test execution, 3.60 seconds total. A complete uncached broad rerun then completed its shared phase without failures and passed safe-bash's 558 runner checks. Its subsequent safe-js phase failed as recorded below; the broad route is not a pass.
- The full safe-bash unit phase completed: 44,160 passed, zero failed/cancelled, 831 skipped and two TODOs (44,993 total). Its 1,346-file maintained selection was not replaced by a focused filter. Skipped optional/qualification cells and TODO blockers remain unverified/unsupported, not passes. This phase took about 1,213 seconds; that wall time is an observation, not a performance guarantee. The shared phase separately reported two skipped tests and five TODOs.

Known broad-route TODOs include CSV-format numeric/null native serialization and Pandoc's named shell XLSX descriptor path; those cases remain unsupported, not passes. The isolated comparator output also reports unavailable comparison tooling. Captured MIME comparisons retain their mismatches (24/26 exact types, 23/26 exact combined results); these historical unrelated captures are not new native ssconvert compatibility passes.

### Broad failure investigation and incomplete work

The final `npm test -- --no-cache` returned exit 1 at the safe-js workspace: 1,464 files passed, three failed and three were skipped; 31,118 tests passed, three failed and 48 were skipped. That phase took 1,869.86 seconds. Each failure was the unchanged five-second test timeout, not an assertion about ssconvert:

| Failing file/case | Fresh complete-file investigation |
| --- | --- |
| `safe-js/src/interp/function-prototype.test.ts`: named function metadata/prototype constructor identity | 24 passed; 896 ms tests, 3.07 seconds total |
| `safe-js/src/interp/float32-find-last.test.ts`: truthy predicate result with throwing `then`/`valueOf` getters | 16 passed; 689 ms tests, 3.13 seconds total |
| `safe-js/src/interp/globals/array-from-proxy-order.test.ts`: proxy iterator observation before construction | 12 passed; 370 ms tests, 2.64 seconds total |

Current source was inspected and each complete failing file rerun. No deterministic semantic defect was reproduced; no unrelated runtime, test timeout or gate was changed. The full-run timing failures remain open. These successful focused investigations are not completed broad gates. The maintained runner stopped on safe-js failure, so later declared unit tasks and the root posttest stress hook were not completed in that broad invocation. Independently executed ssconvert tests/lint/build and command tests remain their own measured passes; they do not close this broad gate.

Ending Git revision and all 595 aggregate candidate inputs were rechecked and remained identical to the candidate identity above. Temporary logs, generated browser bundle and inspected screenshot from this task are purged after recording results; preexisting out source/oracle artifacts are preserved. No local commit, remote-main delivery or release was performed.

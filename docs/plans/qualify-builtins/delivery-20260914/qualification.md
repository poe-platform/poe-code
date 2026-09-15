# Built-in reconciliation and clean-main delivery qualification

The accounting audit covers all 108 pinned built-ins, intl402 and Annex B built-in category rows with actual corpus results. It does not establish full ECMAScript compatibility. Category-wide current-revision, edition attribution and runtime/replay gates remain named blockers; no historical pass is promoted to the reconciled candidate without revalidation.

## Target and preservation

The target remains ECMA-262 edition 16 and ECMA-402 edition 12, June 2025, Test262 `419d3e0a2273ba01a3bfcbec423f2801425b8e93`, plus the separately pinned extensions already listed in the main evidence ledger. Newer primitive matcher expectations and proposal fixtures do not redefine the edition. Deliberately withheld host authority is not an ECMAScript defect.

The shared checkout began at `fcd686882afb26cd462f46c98be6f99289e0c9fa`, with unrelated staged and unstaged changes. Fetch showed 51 remote-only and 29 local-only commits. A separate checkout on **main**, `/tmp/qualify-builtins-delivery-20260914`, was initialized at remote `dea009de8f6c7ff608f295c6986d56f255570939`. No feature branch, force push, reset of the shared checkout, blanket staging or hook bypass was used. The only reconciliation conflict was the appended ledger section; the remote ledger prefix was retained verbatim and the task section appended.

| Original local commit | Reconciled main commit                   | Scope                             |
| --------------------- | ---------------------------------------- | --------------------------------- |
| e07a8fd3a             | 9c74b88517677b74c253f1af2a69ca2d2adfa0e5 | Category evidence                 |
| bf8bb1dd6             | ecab95846                                | BigInt constructor classification |
| a2bf3b049             | 4ec2d72cd                                | Guest Array length coercion       |
| 9375c0926             | ce905bc83                                | Bare-interpreter RegExp dispatch  |
| a2fb303bb             | 3878df66430ba223dbc66c13ceed4cef270a696d | Typed-array integrity             |
| 8cc270166             | 7c341926a                                | Integrity commit receipt          |
| fcd686882             | 8248fe840                                | Arguments blocker verification    |

Original TDD failures, passing controls, repair sources and receipts remain attached to each atomic commit. These are reconciled deliveries of those repairs, not new claims of authorship or newly discovered defects. Clean-source qualification below covers the actual reconciled candidate.

## Verified evidence reuse

`reuse-audit.json` verifies all 86 preceding artifact hashes, 255 linked focused evidence hashes and all 10,105 recorded source/build hashes against the untouched shared source. That exact closure remains `35cf739c3cb76c7a9d5ed555acf00306bdf0bef2b536992dbff50deacba9f04a`. It is not the clean delivery checkout.

`historical-audit.json` independently verifies all 216 V4 raw reports, all 53,876 pinned fixture hashes, 44 harness hashes and the exact counts of all 108 category rows. Historical totals remain 93,220 passed, 6,388 failed and 3,318 unsupported at `a4476e3fabf1bf5f3c492aa76f38ff0bf3d05e46`. Category parents overlap and must not be summed. The 6,777 individually indexed built-in nonpasses in `../reconciliation-20260913/unresolved-variants.json.gz` retain their owners and named QB-REVALIDATE / edition dispositions unless an exact later receipt supersedes them.

The historical results are also reproducible from the [tracked V4 report archive](../../complete-conformance-runner/baseline-v4/selected-batch-reports.tar.gz), not only untracked working files. `historical-archive-audit.json` verifies archive SHA-256 `1c8c1aabb6263f21c33f44202ae84713242fff2d03dae8b43ff5f08d5c718a28` and all 216 member hashes against both the archive receipt and the category batch receipts. Compressed manifest and mismatch inventory are tracked beside it. No historical corpus was re-executed for this check.

This reconciles Object/Reflect/Proxy and descriptor/prototype, Array/binary, Map/Set, primitive, error, Math/Date/JSON, Promise-job, iterator/disposable, RegExp and Intl evidence through the existing category-to-owner links. No other task is presumed passed. Full owner suites were not repeated solely because this task was requested again.

## Clean candidate checks

Node 22.23.2, ICU 78.2, V8 12.4.254.21-node.56, Darwin arm64. The first clean candidate source/build closure is `a0f086115218c3cf51631991f68f34a3908d761d608d045ba9bdede7d4d46cd4`, at source SHA `3878df66430ba223dbc66c13ceed4cef270a696d`.

- `npm ci --no-audit --no-fund` succeeds, installs 784 packages and runs the normal Husky prepare hook. Its nonfatal postinstall skill-sync warning is retained in the installation log. No package manifest or lockfile was changed.
- `npm run build:workspaces -- --workspace=@poe-code/safe-js` succeeds for the maintained selected dependency closure and all eight built-import checks. An initial focused-test attempt before Intl data generation failed to import its generated module and ran zero tests; it is not a semantic failure or pass. The normal generation/build resolves that prerequisite.
- The four changed regression files pass 29 tests in total: BigInt 5, Array length 8, RegExp dispatch 4, typed-array integrity 12. Scoped ESLint passes for all nine changed source/test files.
- `corpus-command.json` contains the exact maintained-runner argv for the union of the prior affected selections, without duplicates. `corpus.jsonl` completes **370 files / 734 variants: 728 passed, four failed, two unsupported**, exit 1. Every fixture hash is verified. `corpus-disposition.json` records **zero changed statuses** against the corresponding historical repaired selections. The default 3,000 ms deadline and budget configuration are unchanged.
- `arguments-controls.json` replays the eight previously recorded native/source-SDK interaction cases on the clean source: six mismatches and two passing borrowed-iterator controls. No host intrinsic is admitted to make them pass.
- `query-replay.json` passes observable Proxy trap ordering, Promise job ordering and original/pending/completed integrity-query replay.
- `runtime-commands.json` records the exact four-file runtime selection: Node20.20.0 and Node24.14.0 each pass 29 tests; exact Node18.18.0 reports 20 passes, nine prerequisite failures, zero skips. The nine binary tests fail before their intended assertions because RAB/GSAB support is absent. This is QB-MIN-BINARY, not a passing or unavailable cell. No runtime declaration was weakened.

No CLI visual language, output formatter, option or SDK option changed. Existing CLI behavior controls are reused where source-identical; artifact checks are recorded separately. No new screenshot is warranted for these runtime-only changes.

The disjoint remaining-case replay (`remaining-command.json`, `remaining-corpus.jsonl`) completes **26 files / 49 variants: 31 passed, 18 failed, zero unsupported**, exit 1. The combined clean-source selections cover **396 files / 783 variants: 759 passed, 22 failed, two unsupported**. `category-reconciliation.json` maps all 108 categories to historical and partial current results, and assigns every one of the 24 current nonpasses a named blocker; zero are unclassified. The additional legacy caller and ThrowTypeError cross-realm cases remain QB-CALLER and QB-THROWTYPEERROR-REALM. Their errors are recorded, not guessed to be edition defects.

`host-budget-controls.json` verifies unchanged native Uint8Array.prototype after guest mutation and fatal 2,000-step exhaustion through a guest Proxy trap, catch and finally. The guest cannot convert the fatal limit into a normal return.

The maintained package gate is complete (`unit-receipt.json`): **1,365 files passed, two skipped; 29,636 tests passed, 47 skipped, zero failed**, exit 0, 1,170.36 seconds. The clean committed inventory differs from the inherited dirty checkout; membership comes from the maintained package command, not a manual list. `final-build.log` records the refreshed selected build and eight passing built-import checks. `final-built-controls.json` passes all ten artifact behavior/control cases, including pending/completed replay, plus native isolation and fatal-budget checks through the built public API.

## Named unresolved blockers

The current corpus nonpasses have exact identities and complete diagnostics in `corpus-disposition.json`:

| Blocker                    | Variants                                                                      | Disposition                                                                                                                                               |
| -------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| QB-FINALIZATION-OWNER      | Object/seal/seal-finalizationregistry.js, strict and sloppy                   | Runtime requires an execution owner with error reporting; runner/execution integration remains open. No owner authority is silently added.                |
| QB-SHARED-CORPUS-ADMISSION | Object/seal/seal-sharedarraybuffer.js, strict and sloppy                      | Explicit shared-memory runner exclusion, retained as unsupported.                                                                                         |
| QB-MATCH-EDITION           | String/prototype/match/cstm-matcher-on-bigint-primitive.js, strict and sloppy | Newer primitive-symbol lookup expectations remain outside the pinned edition; not an edition pass.                                                        |
| QB-ARGUMENTS-ITERATOR      | Six clean-source interactions                                                 | Native iterator marker is not a guest callable or the realm intrinsic. Runtime, host-copy, snapshot and replay representations need a coordinated repair. |
| QB-MIN-BINARY              | Nine exact-minimum-runtime regressions                                        | Node18 lacks the required resizable/growable backend prerequisites.                                                                                       |

The existing per-category QB-REVISION, QB-EDITION, QB-REVALIDATE and QB-MATRIX blockers remain open. Their recovery is to classify the pinned fixture against the fixed edition, select only its unresolved or changed-source cases, execute the maintained corpus on the exact candidate/runtime, then repair demonstrated defects using failing maintained tests and negative controls. Historical owner reports are evidence to inspect, not completion tokens.

Also retained: QB-DATE-PRECISION; QB-SYMBOL-REALM; Math.ceil, decodeURI, decodeURIComponent, parseFloat and parseInt deadline workloads; RegExp Node18 Unicode backend, indices deadlines and RGI resource limits; full Bun/Workerd, replay and installed-artifact category qualification. Current delivery does not repair or reclassify those gaps. No timeout, budget, assertion, regex-work bound or host-authority boundary changed.

A fresh read of the official edition-16 MakeDay, MakeTime and MakeDate clauses reproduces the original document hash (`date-edition-receipt.json`). The browser tool could not fetch the 8 MB document; a direct primary-source retrieval and standard-library HTML parsing succeeded. `date-rounding-controls.json` records one current Date.UTC mismatch and three passing Number-arithmetic, MakeTime-order and ordinary-day controls. The required Number multiplication/addition returns 34447360; the host backend returns 34448384, which also equals exact-integer recombination. Therefore replacing the operation with BigInt arithmetic would preserve this failure. QB-DATE-PRECISION remains a reproduced edition requirement with a native backend discrepancy, not a proposal mismatch. No Date implementation or general arithmetic was modified.

## Delivery and release

Local commits, remote ancestry, workflow conclusions and actual package publication are independent receipts. The initial evidence-only push delivered `9c74b88517677b74c253f1af2a69ca2d2adfa0e5`. Its Release workflow is https://github.com/poe-platform/poe-code/actions/runs/34792431576 and schema workflow is https://github.com/poe-platform/poe-code/actions/runs/34792431455. The final built-closure corpus (`final-corpus-receipt.json`) is complete at source `3878df66430ba223dbc66c13ceed4cef270a696d`, closure `83d9d55d3776ecdd244863083d1bccadc01e581a7a9625dadaceb82604f99966`: 396 files / 783 variants, 759 passed, 22 failed, two unsupported, zero status changes. This last selection verifies the refreshed compiled artifacts in the recorded closure; no source or test expectation was changed.

The normal runtime push completed and a fresh fetch verifies all four reconciled commits on remote main `3878df66430ba223dbc66c13ceed4cef270a696d` (`runtime-delivery.json`). No explicitly associated issue was supplied. The runtime Release workflow is https://github.com/poe-platform/poe-code/actions/runs/34793702446, and its schema workflow https://github.com/poe-platform/poe-code/actions/runs/34793702314 succeeded.

The initial documentation Release workflow succeeded, including all required validation jobs. Its release step records that its branch was behind the newer remote main, so it published no version; registry observation remained poe-code 15.0.35 at `dea009de8f6c7ff608f295c6986d56f255570939`. The verified successor `3878df664` contains that documentation commit and completed the runtime publication gate described below. This is a no-release outcome, not publication of these runtime fixes.

The scoped workflow https://github.com/poe-platform/poe-code/actions/runs/34793702414 succeeded and published **@poe-platform/safe-js, @poe-platform/safe-fs and @poe-platform/safe-bash 0.1.590**. `scoped-registry-receipt.json` independently matches all three downloaded tarball SHA-512 digests to registry metadata and provenance subjects, and verifies source `3878df664` and the actual workflow invocation. Initial SafeJS metadata, attestation and tarball 404s are retained as propagation observations. Metadata/provenance became visible first; the canonical tarball continued returning 404s. The percent-encoded official registry URL returned the artifact, with an identical verified digest. No package was republished or rolled back to resolve propagation.

The first combined installed smoke attempt lacked the fixture's sibling modules and ran no product checks; copying the complete maintained fixture set, as CI does, resolved the setup error. The final scoped Node and Bun smoke fixtures pass. The ten built-in controls plus host isolation/fatal-budget checks pass through installed SafeJS on both Node22 and Bun. Standalone SafeFS also passes separately on Node and Bun. After normalizing the consumer to an exact registry version, npm audit signatures verifies **18 package signatures and 12 attestations**. The earlier FS-only consumer verifies three signatures and two attestations. Exact commands, versions, failures and terminal outputs are retained in the corresponding logs and `installed-scoped-controls.json` / `installed-scoped-bun-controls.json`.

`installed-array-job-order.json` reuses the recorded Array length/Promise interaction through the installed package on Node22 and Bun: both number conversions finish before the two queued jobs, and repeated executions report exactly 60 node visits on each runtime.

The root runtime Release workflow completed successfully and published **poe-code 15.0.36** from `3878df66430ba223dbc66c13ceed4cef270a696d`. `root-registry-receipt.json` matches the downloaded 34,335,483-byte tarball SHA-512 to registry metadata and provenance, whose source and invocation identify that exact commit and workflow. Installed `poe-code/safejs` passes all ten repair controls plus native isolation and fatal-budget checks on Node22 and Bun (`installed-root-controls.json`, `installed-root-bun-controls.json`). `root-signatures.log` verifies 208 registry signatures and 38 attestations. Root and all three scoped publications are now independently verified; no publication recovery remains open.

The scoped workflow publishes all three `@poe-platform/safe-*` packages with one version, independently of `poe-code`. Each must receive registry integrity/provenance and installed-artifact evidence; a successful SafeFS publication does not establish SafeJS or Safe Bash publication. For any failed or partial publication, retain the published versions, diagnose the failed workflow step, repair with tests if needed, then use a forward GitHub run containing the verified fixes. Never publish locally, unpublish or destructively roll back. Cancelled/superseded runs require verified successor ancestry.

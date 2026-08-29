# Final independent H5 integration validation

Date: 2026-08-29. Reviewer: Nash, directly delegated; no nested agents.

## Decision

**READY for standalone H5 publication on the verified final PPR1/PPR2 prerequisites. No H5 production repair requested.** This is not final O05/O13/O14 all-stack approval. Completed-Map, HOST-ARRAY-METADATA and O12 bundle-codec work remain separate, and none of those deltas is overlaid here.

Both independent DEFAULT full suites pass: **25,852 tests passed, 41 skipped; 993 files passed, 3 skipped** in each run. Assertions, default workers, Vitest configuration and deadlines are unchanged. There is no hook-timeout override or added test exclusion. The prior scoped report and its HOLD are retained unchanged as historical evidence; this new report resolves that review’s final-prerequisite and default-full-gate holds for standalone H5 only.

## Pull-first workspace and inputs

Workspace: `/Users/kjopek/Workspace/poe-code-safejs-h5-final-independent`.

Cloned publisher origin `git@github.com:poe-platform/poe-code.git` on main, then immediately ran `git pull --ff-only` before staging. Pull returned “Already up to date.” Base: `518def9bc43198efcd1da5a927e086fecd33a574`. Read ancestor and repository AGENTS; no nested applicable instructions were present. No Git mutations after the authorized clone/pull, no commit/push/new branch, no home or other-clone writes, and no README authorship edits.

| Frozen input                | SHA-256                                                            | Verified role                                                                              |
| --------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| H5 author                   | `6f58c7ec1dbcd579f9132be1819290bb47d046e75ae7ed6c25249b870f91ee74` | 13 publication paths, 8 author-delta paths, 6 author ordered preimages, 2 production files |
| Prior independent H5 scope  | `85f2626317d4fd5e33cdfca05e80bdf2bbdc5abd82b06dbe9cafebf678201874` | 3 unchanged independent paths and preserved native/RED procedure                           |
| Final PPR1 author           | `cabdebcc481a7371d373000c4990a9bc36c233808f796b692dff76ed1fe9d94b` | Exact runtime and repaired two-process validation setup capsule                            |
| Helm final PPR1 independent | `4c38755b5c6f4e789d869cb65fd8cda384c8ddf8c7916b05be4f067803c31fb1` | 10 approved prerequisite paths; author nine match exactly                                  |
| Final PPR2 independent      | `31d14e25974bf910ec253539458085d903d1c38a6ccd3551b2f4992b1dd136b0` | 28 approved prerequisite paths and the two exact history-format exceptions                 |

Helm locator: `/Users/kjopek/Workspace/poe-code-safejs-promise-aliases-integrated/out/safejs-remediation/ppr-001-final-independent/candidate/manifest.json`. It was found through directory-name metadata beneath the already-authorized closed PPR1 clone; the supplied manifest hash was checked before any listed blob was read. No live author source or original audit payload was read.

All 587 H5 listed artifacts were verified. For PPR1, 279 artifacts were verified while two original-source support blobs were deliberately not read; they are unnecessary for published tests. All 211 PPR2 artifacts and the ten Helm publication postimages were verified. The input manifests are captured under `candidate/inputs/`; the exact external locators and intake receipts remain in the evidence.

## Exact composition

Only approved publication postimages were applied, with matching main/ordered preimages. The newer current-main CTX interpreter was preserved: `packages/safejs/src/interp/interpreter.ts` SHA-256 `d3e317129835f99d75e6607f97fa49805504de3c6c003fe800c3684416bb8d8f`. No old 50-path prerequisite source overlay was used.

| Runtime path                                | Ordered predecessor                                                     | Tested final SHA-256                                                    | Bytes |
| ------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----- |
| `packages/safejs/src/interp/host-bridge.ts` | PPR1 `963698796bc0f846a319376762dab65918634223f4ceedd8eaf70da2e0543e83` | `4ee1fad8e50568478ab5cb0bc6923aa77c40a3811ba53c8d14c23c633bbfb1b4`      | 35998 |
| `packages/safejs/src/interp/host-call.ts`   | `1f8bec1f24ddd58f343b6a314f8deff05ef4c67dd879ca82ce523186ca84a6cc`      | `b8abcf757ac5d4af1a8fb1af96758cd7d703b93c172304edb940d6d413c67d7f`      | 26942 |
| `packages/safejs/src/interp/values.ts`      | G01 `a453757823a826a5c533a5b13e44cdb2021783889e90601608bac932f5f3db86`  | PPR1 `394b4b1d60d8cf54c100930dde1ae1b058961e86c524e11eee1de56ec2c2a84e` | 26580 |

The bridge’s pulled-main preimage is `e2c9519a3b4fb3ae4405fdf5aa5cf7fb29335c2236c0de2b995a6e4b5f149c5d`; PPR1 changes it to `963698...`, then H5 changes it to `4ee1fa...`. Applying a PPR1 preimage after H5 would undo H5 and is not authorized. H5 does not alter the generic converter in `values.ts`.

The aggregate H5 publication has **17 unique paths**: all 13 author paths, the 3 frozen prior independent paths, and this new final report. Prerequisites stay separate: final PPR2 28 and Helm/PPR1 10. The full set has 54 distinct overlaid identities because the PPR1/H5 bridge is ordered on one path. The H5 aggregate patch is not the author’s eight-file delta patch: its five unchanged Nash author-publication files must not be omitted.

The clean projection is `/Users/kjopek/Workspace/poe-code-safejs-h5-final-independent/out/safejs-remediation/h5-final-independent/clean-publication`. It starts from a read-only archive of the pulled base (3,829 tracked paths), contains only publication overlays, has its own dependency installation/builds, and has no `out/` support directory. It does not contain the PPR1 validation-only test/config or the seven old H5 manual support identities. Helm’s additional report and this final report are documentation-only finalization; all runtime/test/config hashes match the tested projection before sealing.

Runtime source manifest: `runtime-source-manifest.json`, SHA-256 `013a85c35812a7dac03f366863380a05b7ead0a36634c5f69e66f778d5e1dc7b`; it pins 125 current TypeScript source files. Fresh process controls use a single ESM build of this public entry and a fixture library importing that same interpreter instance, not old dist or a private runtime wrapper.

## Public converter and unchanged oracles

`packages/safejs/src/index.ts:17` exports `HostCallResumeContext`; `host-call.ts:61` declares `toSandboxValue(value: unknown): SandboxValue`. The method is supplied on the genuine active resume context, not as a generic standalone native-function converter.

`host-bridge.ts:151` creates the per-host-call WeakMap; line 710 registers exact wrappers produced by the existing closure bridge. Conversion at line 374 checks active lifetime and abort state, uses the existing cycle-aware data copier, and expires in reconciliation’s `finally` at line 387. Lines 840/846/848/874 refuse raw sandbox capabilities, resolve registered wrapper identities, and reject unregistered functions and unresolved promises. Proof conversion does not fall through to broad injected-callable wrapping.

The unchanged author tests plus five existing independent tests verify function/object/list/Set aliases, captures and cycles, real request/callback IDs, joined/detached disposition, conversion expiry, and ordinary native/foreign-context rejection. Pure repeated conversion leaves callback keys, callback records, replayed IDs and calls unchanged. It does not invoke `compute`; guest code subsequently invokes it exactly once. Returning a reconstructed function is not starting a callback. The independent native result remains value 7, pre-call compute count 0, one callback and one compute call, all tested aliases/cycle true, and calls exactly `["after-host", "compute"]`.

All 13 author postimages and all 3 prior independent postimages are byte-identical to their frozen inputs. The original generic-converter-to-context-API fixture change remains the supported representation; no expected semantic assertion is changed here. In particular, the author’s documented fresh completed-Map `map: false` expectation is preserved exactly, not strengthened or removed in this standalone capture.

### Fresh RED and GREEN

The current-main runtime with only the two exact H5 ordered production preimages substituted reproduces **8 pass / 2 fail of 10** using the frozen original fixtures:

- `packages/safejs/test/final-async-proof-adapter.test.ts`: original callbackFunction recovery fails with `Unsupported sandbox value at <root>[0].compute: function`.
- `packages/safejs/test/final-async-proof-representation.test.ts`: returned source-function/alias proof fails with `Unsupported sandbox value at <root>.compute: function`.

These are fresh semantic REDs, not missing-method errors. The substitutions are confined to an explicitly diagnostic in-memory public bundle; the publication source is not reverted. Current default-config focus passes **21/21**. The clean portable author config passes **16/16** with no `out/` or old-clone test dependency.

### Original native-first workflows

| Original case                                                              | Source SHA-256                                                     | Fresh modes and result                                                                                          |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| O05 `async-replay:/schedulerBoundaries/1`, function-bearing callback proof | `2c89d4b9263d5adef1d04d0c9cb034be894d537526b7d5e220addf6c5c8181b3` | Native, in-process recovery, capture child, separate fresh resume child: all value/call/consumption checks true |
| O05 `async-replay:/correctedBoundaries/3`, data callback proof             | `464e5059007e0c8970604ffdb90aec4663fa115f908a90f330ffe871b1a64611` | The same four modes all pass                                                                                    |

The unchanged inline child procedure has SHA-256 `f2e13ed9ecf607564f0f20d2cc812aede74c66244b4155c5effca22c6b8d227c`. It is executed inline from the frozen Markdown procedure; no executable QA runner is added. Each original has 12 native calls. Each fresh resumed execution makes the exact remaining 10-call suffix, invokes one provider, returns one real anchored proof, and consumes that call record. In-process recovery also consumes every returned proof. The complete workflow returns six callback results with counters `{ callbacks: 6, total: 410 }`; full values, traces, typed output graphs, serialized pending/completed checkpoints, genuine IDs, receipts and call arrays are retained in `original-workflow-results.json` and the eight `commands/original-*.json` receipts. No function is invoked by the provider to replace or erase a function graph.

The finite schedule uses explicit held/released gates and unchanged bounded observation budgets. An intentionally held future proof is not called a timeout regression. The eight executions are H5 original controls, not a final verdict on all twelve O05/O13/O14 profiles.

## Actual gates

Each raw command receipt records exact argv, cwd, stdout/stderr, status and inline program/stdin where applicable. `command-index.json` indexes them. No author or prior-review count is substituted for a fresh result.

| Gate                                      | Actual command / scope                                                                                          | Result                                                  | Receipt                                                                        |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Workspace DEFAULT full                    | `env -u TERM npm run test:unit`, unchanged root config                                                          | 25,852 pass, 41 skip; 993 files pass, 3 skip            | `commands/workspace-default-full.json`                                         |
| Clean publication DEFAULT full            | Same command in clean projection                                                                                | 25,852 pass, 41 skip; 993 files pass, 3 skip            | `commands/clean-default-full.json`                                             |
| Forced workspace packages                 | `turbo run build --force`                                                                                       | 67/67, zero cached                                      | `commands/workspace-force-build.json`                                          |
| Forced clean packages                     | Same command in clean projection                                                                                | 67/67, zero cached                                      | `commands/clean-force-build.json`                                              |
| Both complete root builds                 | `npm run build` after each forced package build                                                                 | Pass, including root declarations/codegen/bundles       | `commands/workspace-root-build.json`, `commands/clean-root-build.json`         |
| Current default focus                     | `vitest run` with the five H5 test paths, default root config                                                   | 21 pass                                                 | `commands/current-default-focus.json`                                          |
| Clean portable author config              | `vitest run --config packages/safejs/test/final-async-proof.vitest.config.ts`                                   | 16 pass                                                 | `commands/clean-portable-author-config.json`                                   |
| Fresh ordered RED                         | Exact two-source preimage bundle and original fixtures                                                          | Expected 2 fail / 8 pass                                | `commands/fresh-original-red.json`                                             |
| Clean configured lint                     | `npm run lint`                                                                                                  | ESLint, root configured TypeScript, actionlint all pass | `commands/clean-configured-lint.json`                                          |
| SafeJS configured types                   | `tsc -p packages/safejs/tsconfig.json --noEmit`                                                                 | Exit 0                                                  | `commands/safejs-configured-types.json`                                        |
| Author configured types                   | `tsc -p packages/safejs/test/final-async-proof.tsconfig.json --noEmit`                                          | Exit 0                                                  | `commands/author-configured-types.json`                                        |
| Owned + author public declaration types   | Exact root list and actual freshly built `packages/safejs/dist/index.d.ts`                                      | Zero diagnostics                                        | `commands/owned-and-author-declaration-types.json`                             |
| All publication formats                   | Configured Prettier; exact two authorized history exceptions only                                               | Pass, including final reports                           | `commands/final-publication-formats.json`                                      |
| Current strict diff / all file whitespace | `git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab diff --check`, plus per-file no-index checks | Exit 0; all diagnostic streams empty                    | `commands/final-current-strict-diff.json`, `final-publication-whitespace.json` |

Command wrappers also set `HUSKY=0`, `DO_NOT_TRACK=1`, `TURBO_TELEMETRY_DISABLED=1` and a clone-local npm cache where recorded. Dependency installs use `npm ci --ignore-scripts --no-audit --no-fund`; no home install or lifecycle-hook Git mutation is used. No test timeout, worker count or assertion is altered. Do not sum overlapping focus/full counts.

The two package-local PPR2 historical JSON fixtures remain byte-exact and the `.prettierignore` remains exactly the authorized two anchored paths. This is not a blanket formatter waiver. `.prettierignore` itself is hash-checked, not passed as a source file to Prettier. Current strict-diff diagnostics are empty; historical AW patch-application warnings are not used to excuse a current-file failure. The prior owner qualification of 56 expanded legacy PPR2 type diagnostics is not silently converted into “all types pass”; this review independently passes configured root/SafeJS and owned H5 type scopes and does not re-adjudicate that expanded legacy scope.

## PPR1 setup capsule boundary

The final repaired setup postimage is `35cdfb7d2b23860dc75327f58e55e8d26ac951e55100e1825cc3c6fd607e9756` (37,273 bytes). Static comparison confirms all 149 extracted `expect(...)` parent expressions are identical; the change batches pending captures in pairs of TWO fresh processes. The setup’s child programs, assertions and deadlines are not rewritten here.

This **validation-only**, expressly non-publication test still directly reads the original audit inventory and two original source payloads in `beforeAll`. Under this task’s no-original-payload instruction it is not executed or added to the publication projection. Its separate historical config contains a 30-second hook timeout; that config is not used. This is not a new H5 regression or a modified default exclusion. The exact PPR1 runtime is executed by the default published tests and H5 oracles; Helm’s approved setup execution remains independent prerequisite evidence, not a count claimed here.

The public H5 fixture/config dependency AST scan has no `out/`, old-clone, or original-audit path literals. The published PPR2 default history test reads genuine local fixtures by relative URL; it does not rely on the old ignored manifest/preimage support. The history qualification remains eight negative raw-v6 invocations over four distinct packaged snapshots, not eight distinct snapshots. Older eight-distinct-history evidence stays separate and untouched.

## Separate open scopes and constraints

- **Completed-Map**: preserve the native/initial true versus completed-replay false alias finding; source SHA-256 `fee18fa1cb868e0ee313393032be182b9835b1b4be6f7f1b3cc036b5e0406a38`. Boyle’s new five-file author seal `ab175939e3cbd56dd899e37e99aa010f647b8684a80f83093ee21dff4c0d6b2f` is not read or overlaid here; Aquinas’s independent review is separate. Only the later Map delta is authorized to strengthen the fresh H5 assertion to native true.
- **HOST-ARRAY-METADATA**: the newly reported loss of callback-array own properties before checkpoint is Boyle’s separate scope. No duplication, fix or blanket array-metadata correctness claim is made here.
- **O12 bundle-codec**: Curie owns it. `public-helper-surface.json` supplies exact public context/type/source boundaries if coordination is needed. No codec investigation or broader callable acceptance is introduced.
- **Final lifecycle matrix**: O05/O13/O14 all-stack approval waits for final ordered source composition and its own execution. These H5 results do not replace that matrix or H7 CLI/SIGINT validation.

The inherited exact 38 exclusions plus the entire security prefix remain guarded, and the whole original audit root is denied. No original audit payload, excluded read/hash/execute, security research, LLM or guest real I/O probe, forged proof, marker rewrite, private proof adapter, generic native-function guard weakening, or runtime repair is performed. Standard configured default tests are run without adding stress/slow-probe flags. There is no new CLI-facing behavior or screenshot claim in this converter-only review.

## Publication handoff

`out/safejs-remediation/h5-final-independent/candidate/manifest.json` seals the exact 17 unique H5 publication postimages, current-main preimages, ordered source preimages, aggregate publication patch, separate approved prerequisite manifests, command receipts, source/fixture hashes, complete original outputs and explicit limits. All 16 earlier H5/review files remain byte-identical; this final report is the only newly authored publication path in this continuation. The old `85f262...` scoped capsule is not edited.

Root must apply H5 after the verified PPR2/PPR1 queue entries, preserve newer main/CTX and later fixes, and rerun actual publisher-main integrated gates. Do not apply this standalone H5 patch over the later Map assertion change or other overlapping author deltas blindly. Independent standalone readiness is not permission to commit/push and is not final all-stack readiness.

# COMPLETED-MAP-VALUE-ALIAS author repair

## Scope and baseline

- Date: 2026-08-29. Direct author work; independent review and publication are separate.
- Isolated main clone: `poe-code-safejs-completed-map-alias`.
- Publisher origin: `git@github.com:poe-platform/poe-code.git`.
- Clone followed immediately by `git pull --ff-only origin main`; base `bdf58b2437925bfc021b13e31daf216d292a3d68`.
- NUM arity, OBJ2 sparse/named-array snapshots, shadowed array methods, and G01 measurement are already upstream. No prerequisite was staged.
- No original audit payload, excluded path, security research, real provider, LLM, or guest I/O was needed. Only the explicitly supplied benign witness and frozen manifest-addressed files were read outside this clone.
- No commits, pushes, additional branches, README edits, inline comments, or other-clone edits. Dependency installation uses `SKIP_SYNC_SKILLS=1` and a clone-local npm cache; SSH host-key updates are disabled.

## Witness and diagnosis

The frozen parent manifest is `6f58c7ec1dbcd579f9132be1819290bb47d046e75ae7ed6c25249b870f91ee74`. Its `completed-graph-baselines.json` has SHA-256 `cdc36a0c3f6004fd96198d7d48fbc1f99d164acb8b0ff4e8808b0b6eb6bd1f5d`. The unchanged benign source has SHA-256 `fee18fa1cb868e0ee313393032be182b9835b1b4be6f7f1b3cc036b5e0406a38`.

Current published main independently reproduces the finding without PPR1, PPR2, or H5 staged. Native and initial execution return `{ value: 7, closureAlias: true, objectAlias: true, cycle: true, map: true, set: true }`. A fresh-process completed restore returns the same fields except `map: false`. No completed replay calls the host, gate, or resume provider.

`HostCallJournal` retains and exposes outcome copies through `copyOutcome`. `deepCopyToSandbox` copies ordinary records and arrays but intentionally retains already-branded sandbox Maps and Sets. Thus copying `{ shared, map }` allocates a new `shared` while the retained Map still points to the old record. The serializer faithfully encodes a graph already split by retention; the Map decoder is not the root cause. Closure identity and a Set containing only that closure survive because closure capabilities are retained intentionally.

The repair replaces the import and the fulfilled/rejected calls with existing `cloneSandboxValue`. That operation clones branded collections, records, and arrays with one memo table, registering containers before descent. It preserves aliases and cycles without adding a representation, helper, compatibility marker, conversion rule, or production complexity for tests. `values.ts`, measurement, host provenance conversion, and snapshot decoding remain byte-for-byte unchanged.

## TDD and coverage

1. Run the captured source on untouched current main and capture native, initial, and fresh completed observations and snapshots.
2. Add four journal cases: fulfilled/rejected outcomes, each with object-first/collection-first traversal. Assert copied collection identities, shared Map keys and values, Set object membership, reciprocal/self cycles, retained source closures, sparse slots, explicit undefined, named metadata/raw aliases, shadowed `map`, and snapshot isolation from later mutations. Exercise retained-record reconstruction and serialized replay.
3. Add two public runtime cases: the exact six-field witness and a 25-field control combining Map/Set/object/function cycles and aliases with default/rest/bound function arity and sparse/named/shadowed arrays. Compare native, initial execution, and two completed in-process restores. All callbacks are finite pure stubs; completed restores must not reissue them or call a provider.
4. Capture all six isolated cases RED before changing production. Replace only the existing outcome-copy operation. Confirm six GREEN and the complete graph observations in separate fresh processes.
5. Run final identical tests on a clean base publication projection, then apply the production delta and repeat. Run all configured gates and explicit new-test typing; retain failures and exact diagnoses.

Two fixture corrections are recorded rather than concealed. Native object prototypes differ from SafeJS observation-record prototypes, so the comparison uses `structuredClone` of the primitive observation record; every field and array key is still checked strictly. A retained-record-only journal does not enable recorded replay, so its constructor-copy coverage reads `snapshot()` rather than calling an inapplicable `replayOutcome`; serialized replay remains separately asserted.

The first expanded fixture also found a distinct **initial host-boundary array metadata loss**: named `metadata`, `raw`, and shadowed `map` disappear while crossing the guest-callback/host conversion, before completed replay. Its native and initial outputs and source are captured separately. This is not claimed fixed here. The public combined checkpoint control attaches those properties after the host boundary; the journal tests independently retain named properties inside outcome graphs. This isolates the requested completed-graph defect without changing the native oracle or erasing the separate observation.

## Prior ordering and overlaps

- Provisional PPR1 capsule `e2374833611703aa57149f384969ba83dedb36c38901c0fe6c89b9a3694973ed` touches `interp/values.ts` and `interp/host-bridge.ts`; neither is owned by this delta. No provisional approval is implied.
- The supplied Turing G01/PPR1 composed `values.ts` hash `394b4b1d60d8cf54c100930dde1ae1b058961e86c524e11eee1de56ec2c2a84e` is advisory until its immutable runtime locator is supplied. This fix does not edit that path.
- H5's frozen `interp/host-call.ts` postimage is `b8abcf757ac5d4af1a8fb1af96758cd7d703b93c172304edb940d6d413c67d7f`; the shared current preimage is `1f8bec1f24ddd58f343b6a314f8deff05ef4c67dd879ca82ce523186ca84a6cc`.
- H5 adds `toSandboxValue` to `HostCallResumeContext`, a different hunk from the import and `copyOutcome` changes here. There is a production-file overlap, even though the hunks are disjoint. A textual three-way check reports zero conflicts and composed hash `dea680fb83c7210af24b2d5a8574714b2d37451ce63bcfd53a8789eb611bb4c5`; it is not a staged or approved combined runtime. Final ordered integration must follow the root-provided final priors; this current-main author candidate is not combined approval.
- PPR2 packaging refresh manifest `442d7028a286a43b2e9bcb6d5b3a54df11438a4bd5d4860bb874f75b3e4a2ade` is hash-verified, with source unchanged and independent packaging review pending. Its production paths (`run.ts`, `restore.ts`, `snapshot/dump-format.ts`, `snapshot/migration.ts`) do not overlap this delta. It is unnecessary for current-main reproduction and is not staged.

## Validation record

Evidence and exact command output are under ignored `out/safejs-remediation/completed-map-alias/`; publication files have no imports from that directory.

- Initial source build: 67 tasks successful, forced, zero cached.
- Isolated RED: six failed; initial fixture failures and their corrections are retained separately.
- Focused GREEN: six passed.
- Focused adjacency: 165 passed, including existing host-call, value-copy, G01, NUM, OBJ2, shadowed-array, and replay-data tests.
- Complete SafeJS suite: 7,222 passed, 39 skipped; no failed tests.
- Fresh-process comparisons: both full observation records match native on initial execution and two consecutive completed restores; zero provider calls and zero replay host/gate calls.
- Final forced full build: 67 tasks successful, zero cached, 29.693 seconds.
- Default forced full tests: 24,607 passed, 41 skipped; 975 test files passed and three skipped; zero failures, one uncached root task, 230.16 seconds of Vitest execution.
- Explicit strict author-test TypeScript compilation: zero diagnostics. Configured SafeJS source program expanded with both new test roots: 127 roots, zero diagnostics. Configured SafeJS and root source typing also pass.
- ESLint, all 17 package-lint rules across 68 packages, workflow lint, and exact publishable formatting pass.
- Root formatting remains nonzero for 1,434 unrelated files. Every warned file's Git blob is verified identical to HEAD; none is an owned publication file. No unrelated format edits were made.
- Clean tracked-base projection, without an evidence tree or Git metadata: identical final tests fail six RED on the base production file; applying only the three-line production replacement yields 165 focused/adjacent GREEN. Explicit new-test typing passes there. The projection uses a symlink to this clone's installed dependency directory; it is not another clone or a fully reinstalled environment.
- No publication source/test imports an evidence path or another workspace. Generated terminal-pilot font assets from the forced build are excluded from publication.
- In-process evidence records both entire observation graphs and all three snapshots per source, matching the fresh-process results. A pre-fix already-split snapshot still produces `map: false` after the repair; this is captured as a compatibility limit, not reported GREEN.

All failed command outputs are retained. One fresh-process evidence invocation accidentally reused the previous source's snapshot and correctly failed the source-hash check; the corrected source-specific loop passed every comparison. One supplemental TypeScript API command initially contained a quoted-newline syntax error; the corrected command produced zero diagnostics. Neither was a production/test failure or a reason to weaken a gate. Initial REPL TypeScript-loader attempts did not load the module; extraction used the installed compiler through Node instead.

Exact explicit author-test command:

```sh
node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck --strict packages/safejs/src/interp/host-call-graph.test.ts packages/safejs/src/snapshot/completed-map-alias.test.ts
```

All validation commands unset `TERM`; npm commands use the clone-local cache and `SKIP_SYNC_SKILLS=1`. Full tests force recorded playback and fail on missing recordings. New tests do not create files or query external services. The native/fresh-process evidence is collected through inline tool invocations, not a published QA runner.

## Limits and handoff

This repair prevents newly retained outcomes from splitting collection edges. Already-written snapshots containing duplicated records cannot in general recover the lost identity; no migration or version-marker rewriting is added. The separate initial host-boundary metadata observation remains open. No claim covers every Map/Set/array/provenance issue.

Freeze exact owned postimages, current-main preimages, delta patches, source hashes, validation logs, failure diagnoses, and a manifest. Prerequisites remain separately identified, with none staged in this current-main candidate. Independent Aquinas/Nash review and final-prior ordered integration remain required; no publication is authorized by this author handoff.

## H5-ordered integration, 2026-08-29

This addendum concerns a new isolated main clone, `poe-code-safejs-completed-map-alias-ordered`. The earlier four-file author candidate and all neighboring clones/captures remain read-only. The clone was pulled first to `e702430ab3dacfea4a5e4bc7494f7c51953ceba4`. That commit publishes CBI; it is not the separate AR prerequisite. No commits, pushes, additional branches, README edits, or original audit reads were performed.

### Exact input order

1. Current main, preserving published NUM, OBJ2/shadow, G01, CBI and other upstream changes.
2. The 50 effective prerequisite identities in independently ready PPR2 packaging manifest `31d14e25974bf910ec253539458085d903d1c38a6ccd3551b2f4992b1dd136b0`, preserving already-identical main files and composing the missing AR layer through contextual patches.
3. That manifest's 28 PPR2 publication paths, including the two byte-exact package-local historical fixtures and their two exact `.prettierignore` entries.
4. Final PPR1 author manifest `cabdebcc481a7371d373000c4990a9bc36c233808f796b692dff76ed1fe9d94b`, superseding the initially used provisional `e2374833611703aa57149f384969ba83dedb36c38901c0fe6c89b9a3694973ed`. Its G01/PPR1 `values.ts` is exactly `394b4b1d60d8cf54c100930dde1ae1b058961e86c524e11eee1de56ec2c2a84e`, and its host-bridge memoization postimage remains `963698796bc0f846a319376762dab65918634223f4ceedd8eaf70da2e0543e83`. All five explicit G01 identities and PPR2's final 28 are verified in the declared prerequisite order. No racing Turing tree is read; independent Helm review remains pending.
5. Frozen H5 source manifest `6f58c7ec1dbcd579f9132be1819290bb47d046e75ae7ed6c25249b870f91ee74`, followed by all three unchanged Nash review files from `85f2626317d4fd5e33cdfca05e80bdf2bbdc5abd82b06dbe9cafebf678201874`. Nash's scoped pass is not final publication approval.
6. Accepted Map author candidate `233d4cf1961d58d87dea10b23a8d31cdad881950efc6613141677d0a0eb89d09`: unchanged two test files, this appended author plan, and only the original three-line production delta.

All source compositions are conflict-free. Existing files receive contextual `apply_patch` edits, not old whole-file replacements. Frozen test assertions, review reports, and H5 production code are not edited to make this integration pass.

### Pre-H5, post-H5, and Map identities

| Boundary                                                       | SHA-256                                                            |
| -------------------------------------------------------------- | ------------------------------------------------------------------ |
| `values.ts`, G01 plus provisional PPR1, unchanged by H5/Map    | `394b4b1d60d8cf54c100930dde1ae1b058961e86c524e11eee1de56ec2c2a84e` |
| `host-bridge.ts`, effective prerequisites plus PPR1, before H5 | `963698796bc0f846a319376762dab65918634223f4ceedd8eaf70da2e0543e83` |
| `host-bridge.ts`, after H5, unchanged by Map                   | `4ee1fad8e50568478ab5cb0bc6923aa77c40a3811ba53c8d14c23c633bbfb1b4` |
| `host-call.ts`, before H5 / Map author ancestor                | `1f8bec1f24ddd58f343b6a314f8deff05ef4c67dd879ca82ce523186ca84a6cc` |
| `host-call.ts`, after H5 / ordered Map preimage                | `b8abcf757ac5d4af1a8fb1af96758cd7d703b93c172304edb940d6d413c67d7f` |
| `host-call.ts`, standalone Map author postimage                | `32af86194546971a435dabf9db4782af81d6619d64b2cbb7ed241539790bdcc1` |
| `host-call.ts`, H5-ordered Map postimage                       | `dea680fb83c7210af24b2d5a8574714b2d37451ce63bcfd53a8789eb611bb4c5` |

H5 adds the required `toSandboxValue` context member. Map changes only the value-copy import and fulfilled/rejected outcome copy calls. The composed file retains both changes; the converter's provenance behavior and G01 measurement are untouched.

### Assembly correction, not a runtime repair

An initial incomplete assembly staged PPR2's delta without its full effective AR prerequisites. Pre-Map H5/Nash controls then failed with `Sandbox object is already running.` during external capture. The author had incorrectly identified the newly published CBI commit as AR. Those command outputs and provisional hashes are preserved, but are not successful integration evidence.

The declared effective prerequisite layer was reconstructed from untouched main, and only its missing changes were applied. This produces the exact pre-H5/after-H5 hashes listed above. The corrected prerequisite-only runtime passes all 21 H5/Nash tests while all six unchanged Map tests fail RED. No H5 production repair or test-oracle change was made for that setup error.

### Ordered validation and explicit hold

- Six Map regressions fail on the complete prerequisite-only runtime and pass after the Map delta. Focused adjacency passes 165 tests.
- The same final test bytes independently fail six RED in a clean tracked-base publication projection and pass 165 focused/adjacent tests after only the Map production patch. The projection has no evidence tree; dependencies are linked to this clone's installation. It is not another Git clone.
- Both six-field and 25-field native observation records match initial execution, two in-process completed restores, and two fresh-process completed restores under `jobs-v7`. Completed replay calls neither host/gate nor a resume provider.
- PPR1/PPR2 selected runtime/history tests pass 83 cases, including 40 packaged history cases.
- All 23 newly introduced TypeScript roots, including both Map tests and Nash's controls/config, compile strictly with zero diagnostics. Map's exact two-root command and configured package/root/H5 public types also pass.
- The expanded 42-root legacy type scope has exactly 56 diagnostics before and after Map, with identical signatures and zero owned/new diagnostics. It remains recorded RED, not waived or relabeled as a pass.
- The combined and clean-projection forced builds each pass all 67 tasks with zero cached. Both default full test gates independently report 24,800 passed, 41 skipped, and one failed, without timeout overrides. The unfiltered SafeJS gate reports 7,415 passed, 39 skipped, and the same single failure.
- The final PPR1 capsule changes only its captured integrated plan relative to the already composed runtime; production, tests, fixtures, and configurations are byte-identical. The plan refresh is applied contextually in both trees. Validation therefore covers the exact final source/test/config bytes, not an assumed equivalent implementation. Final prerequisite identity count is 99 including H5/Nash; adding the three distinct Map-only paths yields 102 composite identities.
- Clean-projection default ESLint, package lint's 17 rules, workflow lint, and formatting of all supported composite paths pass. The two exact PPR2 historical JSON fixtures retain their approved ignore entries; `.prettierignore` itself is checked as exact configuration text. Root formatting retains 1,434 warnings, every warned file unchanged from HEAD and none in the composite.
- The raw workspace ESLint invocation also traversed the generated projection and reported `prefer-rest-params` in its duplicate `arguments.ts`, outside the original path-specific override. That failure is retained. Default ESLint passes inside the clean projection; the workspace command also passes when excluding only that generated duplicate tree, not any publication source or test. No lint configuration or production file is changed for this artifact-path issue.

**The combined default gate is not GREEN.** Frozen H5 author test `packages/safejs/test/final-async-proof-conversion.test.ts:161` asserts `{ ...expected, map: false }` for a newly executed/captured completed baseline. Before Map this records the known defect; after Map the actual graph correctly has `map: true`. The other 20 H5/Nash cases pass, including all five unchanged Nash provenance controls. This assertion needs an owner-approved H5 oracle refresh for Map-ordered integration. It is not skipped, weakened, or silently changed here. Independent PPR1/H5 approval and combined Map review remain separate gates; the final PPR1 author capsule is now available and verified, not still an absent-source blocker.

The already-split-snapshot qualification is independently retained: a genuine `jobs-v7` snapshot captured by the pre-Map projection still returns `map: false` when replayed with the repaired runtime. No snapshot is retagged and no retroactive identity recovery is claimed. Newly captured repaired graphs and already-written split graphs must not share the same oracle.

### Separate initial host-boundary metadata finding

Minimal source, with pure host stub `async callback => callback()`:

```js
const values = await host(() => {
  const values = [1];
  values.metadata = 7;
  return values;
});
return [Object.keys(values), Object.hasOwn(values, "metadata"), values.metadata === 7];
```

Native and host-side observations are `[["0", "metadata"], true, true]`; initial SafeJS returns `[["0"], false, false]`. A guest-only direct-array control returns the native result. This is reproduced both on new main and on the complete ordered candidate, with zero provider calls and no checkpoint required.

Classification: **separate real functional data loss under the derived pure host-round-trip contract**, pending root contract confirmation and owner assignment. It is not NUM003: no callable own-property assignment occurs. It is not an exotic GenericInput/prototype or raw-native-Promise rejection: the guest creates a plain array with an enumerable own data property, and the host receives it intact. The inbound `copyHostValueToSandbox` array branch copies numeric indices only. No intentional restriction covering this exact accepted shape was found in the examined public contracts. This does not assert a universal promise to preserve arbitrary native object shapes.

Evidence locator: `out/safejs-remediation/completed-map-alias-ordered/metadata/minimal-classification.json`, with exact source/hash, native/current/host observations, direct control, classification, original expanded witness locator, and explicit unassigned-owner status. The latest ordered receipt is `commands/metadata-minimal-ordered.json`. Root assigns a separate owner after clarification; this finding is neither fixed by Map nor waived because inherited. No additional metadata production/test changes are included in the Map delta.

### Root-authorized fresh-capture oracle refresh — August 29, 2026

This append supersedes only the prior oracle-refresh hold and metadata assignment status; the historical captures and report remain unchanged. Root authorizes the Map author to change exactly `map: false` to `map: true` at `packages/safejs/test/final-async-proof-conversion.test.ts:161`. The H5 test preimage is `3e1e08e4bcca9d95f911af69e3bbb61f0c17202025ac7a173325b4a5cbafc73c`; its refreshed postimage is `e0fe6c58980f8a63410c3292611252353037c7fe60e262144bd32bc0e6fd726d`. Every other byte in that file is unchanged, including the native anchor, all six result fields, graph-record comparisons, and provider-replay rejection controls. All three Nash files remain byte-identical.

The test does not load historical data for this assertion. It runs the source anew, dumps `originalBaseline`, and immediately restores that new completed capture. The converted-proof branch likewise dumps its newly resumed result. The pre-edit focused rerun records 26 passes and the one stale expectation failure: actual `map: true`, expected `map: false`. After the literal-only refresh, all 27 H5/Nash/Map tests pass. The genuine pre-Map six-case RED and native-true evidence remain independently preserved. The stronger oracle applies only to newly generated repaired graphs; the genuine already-split `jobs-v7` snapshot still returns `map: false`, with no migration or retroactive repair claimed.

The final Map delta therefore owns five paths: the unchanged three-line `host-call.ts` repair, the two unchanged Map regression files, this appended plan, and the explicitly authorized H5 oracle refresh. The 99 prerequisite identities remain separate and retain the old H5 test bytes; the 102-path combined publication projection overlays the five Map paths. No further production change is introduced.

Root confirms the separate initial host-boundary array metadata loss is a real supported guest-callback-array defect, not NUM003 or an intentional exotic-input restriction. Root assigns this author the follow-on repair in a new isolated clone only after the full Map handoff. That work is not started and no metadata remedy is included here. Its exact source, native/initial observations, preserved evidence locators, and separate ownership are recorded in `out/safejs-remediation/completed-map-alias-ordered-final/metadata/handoff.json`.

#### Final ordered validation after the authorized refresh

- Both default full gates are GREEN without test-selection or timeout overrides: workspace and clean publication projection each pass 24,801 tests, with 41 skipped, across 989 passing files and three skipped files. Their Vitest durations are 248.03 and 210.11 seconds. Both forced builds pass all 67 tasks with zero cache hits; `TERM` is unset throughout.
- H5/Nash/Map passes all 27 cases in each tree; focused Map adjacency passes 165 cases in each tree. The unfiltered SafeJS gate passes 7,416 tests with 39 skips. PPR1/PPR2/history passes 83 cases, including all 40 packaged historical cases. The original Map six regressions and all unchanged Nash assertions remain covered.
- Fresh native/current/in-process/fresh-process graph checks pass for both the six-field original and 25-field richer graph, including two completed replay generations each, with zero provider or completed host reissue calls. The immutable already-split pre-Map snapshot remains a separately recorded expected limitation, not a new-capture oracle.
- All 23 introduced TypeScript roots pass in both trees. The original two-root Map supplemental command, the explicit three-owned-test command including the H5 refresh, configured root/SafeJS/H5 types, and the configured SafeJS program expanded to all 148 roots pass with zero diagnostics. The 42-root legacy supplemental scope still reports the same 56 diagnostics before and after; zero diagnostics are newly introduced or in owned files. That legacy gate remains RED, not waived.
- Clean-projection default ESLint, package lint, workflow lint, and all supported composite/owned publication formatting pass. Root formatting retains exactly 1,434 warnings; every warned file has the same Git blob as the base, with zero composite warnings. No unrelated formatting repair is made.
- The workspace lint attempt excluding only the generated projection also encounters an immutable historical intermediate merge artifact under the old capture. Its exact parsing diagnostic is preserved. Excluding only the three ignored generated/captured output roots passes; no publication source or test is excluded and no tracked lint configuration changes. Clean-projection default lint independently passes without exclusions.

The final capture is `out/safejs-remediation/completed-map-alias-ordered-final/manifest.json`, with exact five-file Map delta, two post-prerequisite preimages, separate 99-path prerequisites, 102-path combined projection, command receipts, preserved failure diagnoses, and byte-exact historical evidence. All 968 artifacts in the preceding held capsule are rehashed unchanged. Independent combined Aquinas/Nash review and prerequisite/publication approval remain required; successful author gates are not publication authorization. After emitting the complete Map and metadata handoff, this author pauses without starting the metadata repair.

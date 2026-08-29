# Independent ARRAY-OWN-METADATA validation

Status: **NOT READY — author repair required**. Delegated worker Noether01a04bb8-3c36-7813-ac93-62401471829c. Findings recorded August 29, 2026, 04:23:54Z (August 28, 2026, 23:23:54 America/Chicago).

## Scope and freeze

- Workspace: `/Users/kjopek/Workspace/poe-code-safejs-array-metadata`.
- Base: `bc85287c08cfa8796af80c76d0dd8dd2ddf7347b`; no Git mutations authorized.
- Frozen author plan: `docs/plans/safejs-fix-array-own-metadata.md`, SHA-256 `1753f090b01cb2d6436f8b5b5b3d5b2ee59c29d6424f8295cc21ff67ec37c61f`.
- All five author code/test fingerprints and the plan fingerprint independently matched before investigation. They remain frozen.
- Validator owns only `packages/safejs/src/metadata-validation.test.ts`, this plan, and evidence under `out/safejs-remediation/array-own-metadata-validation/`.
- No production, README, master-plan, original/shared workspace, staging, branch, commit, or release changes.

## Bounded execution plan

1. Bootstrap original audit exclusions from `inventory-verification.json` only; deny its exact 38 archive-relative paths and the entire `security/` directory before explicit known-file reads.
2. Inspect own-property reader, native method shadowing, receiver preservation, raw metadata, and unchanged runtime access boundaries statically. Do not execute security probes.
3. Establish all ten complete native original outputs before current TypeScript execution; repeat unchanged original sources twice with original budgets and no guest capabilities.
4. Add independent ordinary controls, exercise base preimages in memory where practical, and run focused, relevant broad, source/test typing, lint, and format checks.
5. Check relevant live aliases and bounded in-memory checkpoint behavior. Separate unchanged limitations from candidate regressions; request author repair for a candidate blocker without editing production.
6. Record complete expected/actual original results, precise commands/counts, qualifications, and immutable verified candidate bytes only if READY.

## Safety and validation policy

The historical audit directory is read-only. No broad search traverses it or an audit family. **Zero excluded payloads were read, hashed, copied, or executed.** The guard denies all **38 exact excluded paths plus the entire `security/` directory**. Only exclusion-list metadata was inspected for denied paths; no excluded security payload was opened or content-hashed. Integrity verification covered **allowed historical functional audit inputs**, not the excluded security archive: eight original algorithm sources, four functional reports, and the exclusion-bootstrap metadata (13 distinct allowed files). Test cases create no files and expose no modules, LLM, guest network, filesystem, or process capabilities. Any filesystem unit fixtures must use memfs. No CLI visual change is made, so screenshots are inapplicable. Future merged runtime changes require independent revalidation; any verdict applies only to these exact candidate bytes.

## Blocking independent finding

The new native-first controls fail for all five ordinary own noncallable array method shadows: `undefined`, `null`, `false`, `0`, and `""`. Reads, deletion, restored built-ins, and TypeError classification work; **argument side effects are incorrectly omitted**.

Minimal ordinary example, with no host capabilities:

```js
const rows = [];
rows.map = 0;
const trace = [];
function argument() {
  trace.push("argument");
  return 1;
}
try {
  rows.map(argument());
} catch (error) {
  trace.push(error.name);
}
try {
  rows.map?.(argument());
} catch (error) {
  trace.push(error.name);
}
return trace;
```

Native expected: `["argument", "TypeError", "argument", "TypeError"]`.
Current candidate actual: `["TypeError", "TypeError"]`.
Base array control: `["argument", "TypeError", "argument", "TypeError"]`.

For own `undefined` and `null`, native expected is `["argument", "TypeError"]`: the ordinary call evaluates its argument, while the optional call short-circuits. Current actual is `["TypeError"]`. Base incorrectly invokes both calls through the intercepted built-in, yielding `["argument", "TypeError", "argument", "TypeError"]`. The patch correctly improves nullish optional short-circuiting but loses the ordinary call's argument evaluation.

Static root-cause review:

- `packages/safejs/src/interp/interpreter.ts:2557` and `packages/safejs/src/interp/interpreter.ts:2596` bypass intercepted array dispatch for own members.
- These calls reach `packages/safejs/src/interp/interpreter.ts:3278`, `evaluateResolvedCallExpression`, with the correct receiver.
- That existing helper rejects nullish/nonclosure callees **before** `evaluateCallArguments` at line 3300.
- Ordinary object controls reproduce the same omission on both base and candidate. The helper defect predates the patch; the new array route makes own array shadows inherit it. This is not a newly claimed independent metadata-reader root cause, but it blocks the requested native method-shadowing compatibility validation.
- The base comparison uses both production preimages from `git show bc85287c08cfa8796af80c76d0dd8dd2ddf7347b:<path>` through in-memory module hooks. Both overlays are asserted loaded. No file is reverted or replaced.

**Author handoff:** repair argument-evaluation ordering for noncallable own methods without losing nullish optional-call short-circuiting, publish a new frozen author manifest, then request independent revalidation. The validator does not edit production, weaken the expected results, mark failing tests skipped, or expand the patch unilaterally. All five failing assertions remain in the dedicated validator test.

## Static boundary review

- `packages/safejs/src/interp/methods/array.ts:94`: canonical indices still use own-index checks; special `length` stays first; `Object.hasOwn` distinguishes absent from present falsy/undefined metadata. The fallback still uses the explicit supported-array-method set and otherwise returns undefined. No inherited-chain traversal was added.
- `packages/safejs/src/interp/interpreter.ts:3216`: synthetic `raw` is restricted to registered tagged-template arrays. Ordinary scalar, object, and callable `raw` metadata works. Existing template immutability handling is unchanged.
- Ordinary resolved own calls retain `member.object` as receiver; live receiver, computed-key evaluation order, extracted callable identity, native static callable shadows, and async-own-method controls pass.
- `evaluateResolvedCallExpression` still requires sandbox closures; `invokeSandboxClosure` retains budgeted invocation. The host bridge, module registry, parser/linter, closure brands, property writer, and inheritance restrictions are unchanged by the author patch.
- The unchanged array writer uses its existing descriptor/collection-mutability handling. The reader does not introduce a host-global or module lookup.
- This is a finite static review, **not security certification**. No access-guard attack, prototype fixture, malicious payload, or budget attack was executed. The existing mixed own/inherited author tests remain excluded from this bounded run.

## Original full-output verification

All eight exact source hashes match the frozen author inventory. The guard bootstrapped `inventory-verification.json` SHA-256 `2ff2b353edf16714ee705dd550903a11bae70e1d7a544357de81d540b13ff827`, converted its 38 repository-relative archive exclusions into exact archive-relative denied paths, and denied `security/` before reading any payload. Explicit source reads were the eight paths in the table below. Only these additional known reports were read: `strings/REPORT.md`, `numerics/REPORT.md`, `data-pipelines/REPORT.md`, and `data-pipelines-review/REPORT.md`.

All ten complete native expected values were established in a fresh child **before** either current-TypeScript original run. Top-level-return sources use a bounded native VM wrapper; the numeric export-default sources execute their unchanged module bytes via an in-memory data URL. Both current runs import the clone's TypeScript source, use `modules: {}`, and supply only the original scalar LCS case binding. Numeric runs explicitly invoke the default entry point with `entryPointArgs: []`.

Complete expected values, actual values, exact second-run values, source hashes, statistics, steps, and every differing leaf are retained without truncation in `out/safejs-remediation/array-own-metadata-validation/original-expected-actual.json`. The executed wrappers and exact argv are in `original-executions.json` in the same directory. Both current full values and step counts match the frozen author results exactly; that agreement does not turn the two qualified originals into full native parity.

| Explicit original source / case                           | Current steps, both runs | Full native comparison                                                 |
| --------------------------------------------------------- | -----------------------: | ---------------------------------------------------------------------- |
| `strings/examples/04-semver-coerce-sort.safejs`           |                    10834 | Complete coercions, order, and parsed outputs match                    |
| `strings/examples/06-template-replacement-unicode.safejs` |                      619 | Metadata and all nonreplacement fields match; six STR-03 leaves remain |
| `strings/examples/07-mustache-scanner-offset.safejs`      |                     2999 | Complete nested tokens, consumed lengths, and tails match              |
| `strings/reductions/r01-match-metadata.safejs`            |                       79 | All three metadata reads match; nine key-order leaves remain           |
| `strings/reductions/r02-semver-overlap-progress.safejs`   |                      196 | Complete output matches                                                |
| `numerics/09-histogram-object-configuration.ajs`          |                     3904 | All bins, bounds, IDs, and configuration results match                 |
| `numerics/13-array-metadata-reduction.ajs`                |                       36 | Complete output matches                                                |
| `data-pipelines/lcs-array-diff.ajs`, records              |                     2223 | Complete LCS, five edits, rows, and flags match                        |
| `data-pipelines/lcs-array-diff.ajs`, duplicate IDs        |                     2169 | Complete LCS, four edits, rows, and flags match                        |
| `data-pipelines/lcs-array-diff.ajs`, empty left           |                      324 | Empty LCS, five inserts, rows, and flags match                         |

Important complete-output anchors:

- Unicode token offsets: `[2,13]`, `[0,9,18]`; the third literal-only fixture has no tokens.
- Scanner consumed lengths: `[67,34,19,11]`; all four remaining strings are empty.
- Histogram: all 13 bins and 26 bounds match. Original and input-change bounds are `[0,2.5]`, `[2.5,5]`, `[5,7.5]`, `[7.5,10]`, `[10,10]`; narrow bounds are `[2.5,5]`, `[5,7.5]`, `[7.5,7.5]`. All member IDs, configuration getters, and accessor value also match.
- LCS records: left `[1,2,4]`, right `[0,1,4]`, IDs `["b","c","e"]`; duplicates: left `[1,2,3,4]`, right `[0,1,3,4]`, IDs `["b","c","b","e"]`. All final `matches` and `originalUnchanged` flags are true.

Limits are unchanged: ordinary originals use 150000 steps, call depth 48, string length 32768, array length 4096, data size 2097152, deadline 2500 ms; LCS uses 300000 steps, depth 96, string length 131072, array length 2048, data size 524288, deadline 3000 ms. Native VM timeout is 1500 ms; child heap is 192 MiB; native child timeout is 10000 ms and each SafeJS ten-case child timeout is 20000 ms. No limit was raised.

## Pending checkpoint functional issue

**Status: PENDING, unresolved functional issue — custom array metadata is lost across checkpoint serialization.** Reproduction on base establishes provenance; it does not dismiss, resolve, or waive this issue. This is an **additional observed but unasserted compatibility failure**, not one of the five failing Vitest tests. Those five failures concern noncallable-method argument ordering only. The checkpoint witness command exits 0 because it prints expected/actual data; it does not assert preservation. Equality asserted between base and current establishes that both lose the same metadata, not that either is correct.

Live custom metadata and `raw` aliases survive ordinary mutation and the independent live alias control passes. A bounded in-memory `serialize` → JSON → `restore` control additionally checks the input graph's preservation expectation; this is not a native JavaScript checkpoint API comparison.

| In-memory checkpoint property                  | Preservation expected    | Current | Base    |
| ---------------------------------------------- | ------------------------ | ------- | ------- |
| Array alias identity                           | true                     | true    | true    |
| Indexed element aliases shared metadata object | true                     | true    | true    |
| Own `metadata` aliases shared metadata object  | true                     | false   | false   |
| Own `raw` aliases shared metadata object       | true                     | false   | false   |
| Own `metadata` remains present                 | true                     | false   | false   |
| Array keys                                     | `["0","metadata","raw"]` | `["0"]` | `["0"]` |
| Plain object's two metadata aliases            | true                     | true    | true    |

The complete serialized checkpoint and controls are retained in `checkpoint-metadata-control.json` and `checkpoint-base-control.json`. The current raw log calls the input-graph expectation `nativeExpected`; that label does **not** mean a native checkpoint implementation was invoked. The base log and summary use the explicit preservation-expected terminology.

The existing concrete witness constructs `metadata = { count: 5 }`, `rows = Object.assign([metadata], { metadata, raw: metadata })`, a second binding `alias: rows`, and a plain-object metadata control. It executes `serialize` → JSON roundtrip → `restore` with source `return null;` and `modules: {}`. Expected: own `metadata`/`raw` remain present and alias the shared object, with keys `["0","metadata","raw"]`. Actual on current and base: both custom fields disappear, alias/presence checks are false, and keys become `["0"]`; array identity, indexed-object identity, and the plain-object metadata control survive.

The exact already-executed command is preserved as the complete `argv` array in `out/safejs-remediation/array-own-metadata-validation/checkpoint-metadata-control.json`: `node --max-old-space-size=192 --import tsx --input-type=module -e <argv[6]>`. That file retains the complete inline program, expected/actual output, and serialized checkpoint; `checkpoint-base-control.json` retains the base execution. These commands are evidence references, not requests for a new runtime campaign.

The serializer's array representation at `packages/safejs/src/snapshot/serialize.ts:444` emits indexed items only; the array schema at `packages/safejs/src/snapshot/serialize.ts:65` has no custom-property field. Both `snapshot/serialize.ts` and `snapshot/restore.ts` are byte-identical to base, and the same full control result/checkpoint is reproduced with base production loaded in memory. This remains an explicit pending functional issue for disposition/repair and eventual asserted revalidation, separate from the five call-order failures. No serialization expansion, production repair, or new runtime execution is performed for this clarification.

Other qualifications remain separate:

- **STR-03:** exactly six unchanged replacement leaves (`annotated`, `prefixViews`, and `suffixViews` on each of the first two Unicode fixtures). Full expected and actual strings are retained in the original-results artifact.
- **Regex metadata key order:** native `["0","1","index","input","groups"]`; current `["0","1","groups","index","input"]` for each of three APIs, producing nine leaf differences. Metadata values are fixed, insertion order is not.
- **Legacy interpreter-test typing:** the extra unconfigured strict command still has 154 diagnostics. It is not claimed green.

## Actual commands and counts

All commands run in the isolated validation workspace. `out/safejs-remediation/array-own-metadata-validation/commands.json` records exact argv, stdout/stderr, exit code, start time, and duration for test/type/lint/control executions; the individual command JSON files retain the same records. These are results, not executable QA scripts.

1. Independent RED: `node --input-type=module -e <recorded startVitest command>` loads the two base production preimages in a Vite transform, entirely in memory. **14 failed / 14**, exit 1; 671 ms. No production file is mutated. The test file is written before this run.
2. Focused current: `./node_modules/.bin/vitest run packages/safejs/src/metadata-validation.test.ts packages/safejs/src/run.array-own-metadata.test.ts --reporter=verbose`. **21 passed, 5 failed / 26**, two files, exit 1; 663 ms. The 12 frozen author tests pass; independent tests are 9 passed and 5 failed. No author historical TDD counts are presented as new validator work.
3. Relevant broad:

```sh
./node_modules/.bin/vitest run packages/safejs/src/metadata-validation.test.ts packages/safejs/src/run.array-own-metadata.test.ts packages/safejs/src/run.references.test.ts packages/safejs/src/interp/interpreter.test.ts packages/safejs/src/interp/methods --testNamePattern='^(?!.*(?:exposes intercepted array members|does not expose prototypes|dangerous array properties|does not expose host prototypes|__proto__|inherited|spreads only an object)).*$' --reporter=dot
```

Result: **651 passed, 5 failed, 9 intentionally filtered / 665**, nine files, exit 1; 1.89 s. The existing author-selected tests retain their 642 passing outcomes. This is not a full repository/adversarial run.

4. Existing checkpoint controls: `./node_modules/.bin/vitest run packages/safejs/src/run.snapshot.test.ts --testNamePattern='preserves .* when restoring an await checkpoint' --reporter=verbose`. **5 passed, 26 intentionally filtered / 31**, exit 0; 1.03 s. Only the five ordinary captured-state/await cases execute; filesystem mocks use memfs. No agent/LLM case executes.
5. Source types: `./node_modules/.bin/tsc -p packages/safejs/tsconfig.json --noEmit`: exit 0.
6. Scoped test types:

```sh
./node_modules/.bin/tsc --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck --noEmit packages/safejs/src/run.array-own-metadata.test.ts packages/safejs/src/interp/methods/array.test.ts packages/safejs/src/metadata-validation.test.ts
```

Exit 0. The same strict command additionally naming `packages/safejs/src/interp/interpreter.test.ts` returns **exit 2, 154 diagnostics**. A compiler-host comparison replacing all four tracked author code/test files with base preimages in memory gives 154 diagnostics on each side, identical by file, line, column, code, and message. Normalized diagnostic-list SHA-256: `a299a9a0ab83e7c5f33cbebb7d2641f2ceaff63c0b55d874c6a1c124e9334c2d`. This normalization differs from the author's representation; no equality of differently encoded hashes is claimed.

7. `./node_modules/.bin/eslint` on all five frozen author code/test paths plus `packages/safejs/src/metadata-validation.test.ts`: exit 0.
8. `./node_modules/.bin/prettier --check` on those same six paths: exit 0, no formatting changes required.
9. `git diff --check`: exit 0; no Git mutation.
10. Recorded one-off native/current/base controls use `node --max-old-space-size=192 --import tsx --input-type=module -e <recorded command>`. Ten ordinary array/object call controls execute on current and base; the two checkpoint graph controls execute on current and base. These commands exit 0 to report data, **not** to assert native parity. The five failing Vitest assertions are the compatibility verdict.

Harness corrections are retained honestly: the first native wrapper attempt had a quoting SyntaxError and ran no original cases; after correction, all native outputs were established before current originals. The first diagnostic-comparison wrapper also had a quoting SyntaxError. Its first executable comparison found 154 diagnostics on each side but used shifted character offsets; switching to file/line/column/code/message confirmed equality. No failed attempt is counted as a passing test or deleted from the evidence.

## Integrity and handoff

- Dedicated validator test SHA-256: `1c645d808957f96bd02092329fdee0f62b2c17c57b6fa4ee9c9bc98f022ca273`.
- `out/safejs-remediation/array-own-metadata-validation/validation-manifest.json` records all six frozen author files and both validator files, relative paths, exact byte counts, SHA-256, and base preimage identities or explicit absence. Evidence files have their own byte/hash entries. The manifest's final hash is supplied in the handoff, not embedded in itself.
- Frozen author bytes and the **13 allowed historical functional audit inputs/bootstrap metadata files** were rechecked before the initial handoff. This did not read or hash any of the **38 excluded payload paths or any payload under `security/`**. The clarification reads existing validator evidence only; it does not reopen the historical audit directory. Original/shared workspaces remain untouched. All generated files stay in the owned paths.
- The initial `validation-manifest.json` and original evidence are retained unchanged as the historical validation record. `handoff-clarification-manifest.json` records this revised report, the explicit pending checkpoint issue, and unchanged source/test fingerprints; it supersedes the initial report-file fingerprint only. The five source-callability-order tests remain frozen, and no runtime campaign is rerun.
- **No immutable READY candidate is created.** Packaging is conditional on READY, which this validation does not establish. The output directory contains only the bounded NOT READY evidence and handoff manifest, not an approved publication candidate.
- A revised author patch requires fresh hash verification and independent reruns. Any later combined runtime changes also require independent revalidation. No commit, push, publication, or master-plan closure is authorized.
- Clarification complete: return the validation hold to author Heisenberg for repair. NOT READY remains the publication verdict; this handoff is not release authorization.

## Fresh merged ARRAYOWN validation — August 29, 2026

**Verdict: READY for ARRAYOWN plus its required call-order repair on this exact
integrated base/candidate, with the explicit pending follow-ups below.** This new
section supersedes the historical ARRAYOWN call-order hold only for the captured
merged bytes. The earlier five failures, later repair evidence, and current-base
39-failure RED remain preserved. This is not certification of the future publisher's
HI → OBJ → ARRAY integration, and it does not waive the separate COLL typing repair.

### Workspace and freeze

- Workspace: `/Users/kjopek/Workspace/poe-code-safejs-array-metadata-integrated`.
- Current base: `9ed57df23ff62f4d2eeffd6cf0753cc95624424b`.
- Frozen Heisenberg manifest: `out/safejs-remediation/array-own-integration/manifest.json`,
  SHA256 `67033146c54377d0a0188c55ab4579946a0152d2e52f957a22cbf1d8701df542`.
- Incoming previously validated candidate manifest SHA256:
  `051cfa0474bd5d627bf1589b0b4fada3295782a3e653d76199992055361837ae`.
- Independent evidence: `out/safejs-remediation/array-own-integrated-validation/`.
- All nine incoming publishable fingerprints and four current-base preimages were
  verified before execution. Only this validator plan is appended; no production,
  test, author-plan, README, Git, shared-workspace, or other-clone change is made.

### Independent three-way and preservation checks

Re-executed `git merge-file -p <new-base> <old-base> <old-validated-file>` for all four
tracked paths, using only read-only captured inputs and stdout. All four exit 0 with
**zero conflicts and zero semantic repairs**; each output's SHA256 exactly equals
the new frozen publishable. This is not a whole-file replacement from the old clone.
Current-base preimages also exactly equal `git show` at the pinned base.

The interpreter is the only overlapping published production path. TypeScript AST
extraction independently confirms these five COLL functions are byte-identical to
the current base: `isRestorableBindingValue`, `evaluateForOfStatement`,
`evaluateForOfIterator`, `createLoopIterationContext`, and `snapshotableIterationValues`.
The four-path tracked diff has no OBJ001 globals-file overlap. Published COLL,
STR03, MC003, MC001, and TREE regression suites are run on the merged interpreter,
not inferred green from the merge result.

The production diff remains limited to own array metadata reads, own-method dispatch
and receiver preservation, registered tagged-template-only synthetic `raw`, and
argument evaluation before noncallable TypeError while retaining nullish optional
short-circuiting. The existing access/closure/budget boundaries are inspected
statically; no new security probe or arbitrary host-accessor parity claim is made.

### Independent RED, GREEN, and configured gates

The unchanged 26 focused controls and 15 generic call-order tests produce **39 failed,
2 passed** against genuine current-base production preimages. The in-memory Vitest
transform records both overridden production modules loaded; no working source is
replaced. Current merged source then passes **26/26** and **15/15**, preserving all
five original noncallable-shadow cases and the generic reference/getter/receiver/
nullish controls without test edits.

Fresh independent commands, all with `TERM` unset:

- `npm run build`: exit 0, 67 successful tasks; 65 cached and two executed, then root
  generation, compilation, wrappers, and bundling complete before type checks.
- Focused `vitest run` on `run.array-own-metadata.test.ts` and
  `metadata-validation.test.ts`: **26 passed / 2 files**.
- `vitest run packages/safejs/src/run.call-order.test.ts`: **15 passed / 1 file**.
- COLL author/validator tests: **136 passed / 2 files**.
- Published STR03, MC003, MC001, TREE author/validator regressions:
  **380 passed / 8 files**.
- Final combined broad command: **1226 passed / 9 filtered / 1235 total**, 21 files.
  Exact argv and all filtered test names are retained in `broad-final-1226.json`.
  The first reused historical command used a dot-based filter and additionally
  skipped one multiline test name: **1225 passed / 10 filtered**. That result is
  retained, not hidden; the author's final multiline-safe filter restores the extra
  test and yields the required nine intentional exclusions.
- Snapshot directory plus `run.test.ts`, `run.random.test.ts`, `restore.test.ts`, and
  `dump.test.ts`: **279 passed / 12 files**.
- `env -u TERM npm test`: **21833 passed / 41 skipped**, **943 files passed / 3 skipped**;
  one uncached Turbo task, 4m21.245s. This is a fresh full configured execution, not
  cache replay. It includes existing repository guard tests but no new security
  research or excluded historical payload access.
- `tsc -p packages/safejs/tsconfig.json --noEmit`, `npm run lint:types`, root ESLint,
  package lint (17 rules / 68 packages), workflow lint, and `git diff --check`: exit 0.
- Focused strict typing passes for the unchanged new metadata test, generic-order
  test, validator test, and array-method test. Exact flags: `--target ES2022 --module
NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck --noEmit`.

Formatting is qualified precisely: all seven code/test files and the author plan
pass. The incoming validator report already has a Markdown formatting warning at
its verified unchanged parent hash. It is retained append-only as requested, not
silently rewritten or called green. The new append is separately formatted. The
all-nine-file failed formatting command and inherited-warning diagnosis remain in
evidence; no unrelated formatting is changed.

### Original functional inputs and guard

Before any original payload read, the known exclusion-bootstrap metadata was read
and verified at SHA256 `2ff2b353edf16714ee705dd550903a11bae70e1d7a544357de81d540b13ff827`.
The guard restores **38 exact excluded paths plus the entire `security/` subtree**.
There are **zero excluded payload reads, hashes, copies, or executions**. No recursive
audit/family search occurs. This task reads only the eight exact algorithm paths
already listed in the historical table plus the bootstrap metadata: nine distinct
audit files. The four previously known functional reports are allowlisted but not
read during this integrated validation. These are allowed functional audit inputs,
not “security archive bytes reverified.”

All eight original source byte/hash identities match the earlier validated inputs.
All ten fresh native expected values are established before either current-TypeScript
execution. Both current runs use the unchanged sources, original bindings, entry-point
handling, and original budgets. Complete expected/actual values, differences, steps,
and statistics are retained in `original-full-expected-actual.json`; exact commands
and stdin are in `original-native-expected.json`, `original-current-1.json`, and
`original-current-2.json`. Both current outputs and step counts are identical.

| Original case                    | Steps in each current run | Full native comparison                        |
| -------------------------------- | ------------------------: | --------------------------------------------- |
| Semver coercion/sort             |                     10834 | Match                                         |
| Unicode template/replacement     |                       619 | Match, including all former STR03 differences |
| Mustache scanner/offset          |                      2999 | Match                                         |
| Regex match metadata reduction   |                        79 | Qualified: nine key-order differences remain  |
| Semver overlap/progress          |                       196 | Match                                         |
| Histogram/configuration          |                      3904 | Match                                         |
| Numeric array metadata reduction |                        36 | Match                                         |
| LCS records                      |                      2223 | Match                                         |
| LCS duplicate IDs                |                      2169 | Match                                         |
| LCS empty left                   |                       324 | Match                                         |

STR03 is proven resolved here, not assumed from base inclusion: the same fresh native
values match the prior native values, the earlier current output differs at six
replacement leaves, and both merged current outputs have **zero** such differences.
`str03-original-resolution.json` records the exact old differences and new complete
output. Unicode offsets remain `[2,13]` and `[0,9,18]`; the literal-only fixture has
no tokens. Scanner consumed lengths `[67,34,19,11]`, histogram bins/bounds/IDs, and
all LCS edits/indices/identity flags continue to match their complete native outputs.

The regex reduction is **not labeled whole-fixture PASS**. Native own keys are
`["0","1","index","input","groups"]`; current keys are
`["0","1","groups","index","input"]` for each of three results: nine explicit
key-array differences. The actual metadata field values otherwise agree.

Native VM timeout remains 1500 ms; native child timeout 10000 ms; each ten-case SafeJS
child timeout 20000 ms; child heap 192 MiB. Original ordinary/LCS interpreter budgets
remain those recorded above. Guest modules are empty, with no real LLM, network,
filesystem, or process operation. No source adaptations or version-marker changes
are made. Unit tests are unchanged and no disk-writing unit fixture is introduced.

### Explicit pending functional and typing follow-ups

1. **OBJ002 named-array metadata/raw checkpoint loss is NOT merged here.** The exact
   historical witness is rerun unchanged. Expected keys remain `["0","metadata","raw"]`
   with all seven alias/presence flags true. Actual keys remain `["0"]`; metadataAlias,
   rawAlias, and ownMetadata are false, while array/index/plain-object aliases survive.
   `checkpoint-metadata-pending.json` includes the full command and snapshot. This
   was an additional observation, not one of the original five call-order failures.
   A passing checkpoint regression suite does not resolve this concrete witness.
   The separate OBJ002 candidate's success does not certify this serializer.
2. **Regex own-key ordering remains pending**, as detailed above.
3. **Enumerable ordinary host-getter bookkeeping remains pending.** Four previously
   bounded direct-lookup controls pass. Replaying the existing enumerable fixture
   gives native parity for its two array cases, but the ordinary-object callable
   case returns `-1` instead of `10` with repeated getter reads; nullish optional
   object access also adds getter reads. Complete native/current traces are retained
   in `enumerable-host-getter-pending.json`. No new matrix or malicious probe is added.
4. **Three COLL validator supplemental TS2345 diagnostics remain pending Galileo's
   separate repair; they are not waived.** A fresh strict check of
   `packages/safejs/src/interp/globals/collections-iteration-validation.test.ts` exits 2
   at 92:41, 95:39, and 120:42: `Promise<void>` is not assignable to
   `Promise<SandboxValue>`. The test is not edited. Configured types and ARRAYOWN's
   focused test types pass; this does not mean all possible TypeScript checks pass.
   The unrelated legacy interpreter-test 154-diagnostic command is not rerun.

### Immutable scope and publisher handoff

Candidate:
`out/safejs-remediation/array-own-integrated-validation/candidate-20260829-arrayown-integrated-noether/`.
Its manifest captures all nine exact current publishables, four current-base preimages,
the validator report's incoming preimage, complete independent outputs/commands, both
parent manifests, Heisenberg's 39-failure evidence, and the prior validator's five-failure
history. Every copied file has a relative path, byte count, and SHA256; verified copies
are sealed read-only/immutable. The manifest's digest is external in `manifest.sha256`
and the final handoff, not recursively embedded into this report.

The incoming old ARRAYOWN and OBJ002 sparse candidates remain read-only and unchanged.
This approval applies only to ARRAYOWN plus its call-order repair on base `9ed57df...`.
**It does not approve or certify the future HI → OBJ → ARRAY publisher combination.**
HI inclusion is not established here; OBJ002 and other later runtime changes must be
integrated under a new freeze and independently checked. No commit, push, release,
master-plan change, or other-clone write is performed or authorized by this result.

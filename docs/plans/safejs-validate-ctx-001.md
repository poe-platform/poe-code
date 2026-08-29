# CTX-001 independent validation

## Scope

- Work directly as the delegated validator in `/Users/kjopek/Workspace/poe-code-safejs-callback-this`; parent orchestrates.
- Base: `33c73a21fb01875b0e2297ccac955974a0889991`, main. Seven author publishables and all author evidence remain frozen.
- Own only `packages/safejs/src/interp/methods/ctx-001-validation.test.ts`, this plan, and `out/safejs-remediation/ctx-001-validation/**`. Content changes use apply_patch. No production edits, README changes, comments, Git mutations, other clone writes, or publication.
- Bootstrap exactly 38 excluded paths from original inventory-verification metadata and block the entire security directory before original payload reads; use only the five explicit nonexcluded CTX paths. No recursive archive search or excluded read/hash/execute.

## Validation sequence

1. Verify author manifest, seven live postimages, five base preimages, and allowed original copies.
2. Establish strict-native full outputs before current-TypeScript originals; independently reproduce baseline RED via read-only in-memory source overrides.
3. Review actual callback argument positions across supported array methods, Map/Set, and Array.from. Test alias identity, successive callbacks, primitive/falsy receivers, reducer initial values, lexical arrows, and pre-bound functions.
4. Add pure fast independent tests, including active checkpoint/replay where supported. Never weaken failed assertions or convert a known defect into an expected product pass.
5. Build dependencies before configured types; run focused, package, and full configured unit gates with TERM unset, snapshot playback, and snapshot misses rejected. Run configured types/lint and candidate formatting.
6. Preserve NUM-001 unmerged arity and LANG-01 reproduction as unresolved separate issues; do not claim array metadata repaired. Capture exact scoped candidate bytes/preimages/hashes if ready. Multiissue interpreter integration needs fresh independent validation.

## Result: READY for CTX-001 only

Independent receiver validation and all configured gates pass on the exact frozen candidate. This is not overall compatibility, remediation, integration, or publication approval. LANG-01, unmerged NUM-001, and contextual-keyword parsing remain explicitly failing and unresolved. No waiver is granted for them.

## Independent findings

All 43 author manifest entries, seven live publishables, five base preimages, and five original copies match their pinned hashes. Author manifest SHA-256: `1fb0ffcf6548bdc3628d2489cdf3ca342ca97616cf68e88146f91b639c7cce5d`. Its sibling digest file agrees. No frozen author source, test, plan, or evidence is rewritten.

### Callback dispatch review

- `packages/safejs/src/interp/methods/array.ts:171`: the ten supported iteration/search/flatMap methods take callback argument one and receiver argument two. Each iteration helper forwards the same receiver into `callArrayCallback` without inserting it into the callback argument list. Callback arguments remain value, index, and original collection.
- `packages/safejs/src/interp/methods/array.ts:233`: reduce/reduceRight retain their existing initialValue handling. No callback receiver is inferred from initialValue or extra method arguments. Sort/toSorted comparator dispatch is unchanged.
- `packages/safejs/src/interp/methods/map.ts:105` and `packages/safejs/src/interp/methods/set.ts:101`: forEach supplies argument two as the receiver, retaining value/key/Map and value/value/Set callback positions respectively. Existing collection iteration/locking behavior is untouched.
- `packages/safejs/src/interp/globals/object-array.ts:230`: Array.from reads the receiver from argument three and invokes its mapper with exactly value and index. The same path handles array, array-like, string, Set, Map, and generator inputs.
- `packages/safejs/src/interp/interpreter.ts:3341`: the three method-option adapters pass the receiver through the existing invocation context. Source closure construction, lexical arrow binding, pre-bound receivers, and bound argument composition are not reimplemented. No function-arity metadata is added.
- Review of the exact five production diffs finds no array own-property metadata, collection-lock, or LANG-01 fix. Future integration touching the shared interpreter requires a new independent validation.

### Independent regression coverage

The new actual-package test file is `packages/safejs/src/interp/methods/ctx-001-validation.test.ts`. Its 37 tests cover:

- Ten array callback sites with aliased callback/receiver references, two successive different receivers, mutation counts, original collection identity, and exact callback argument counts.
- Map/Set key/value positions and receiver aliases across multiple callbacks.
- Six Array.from input representations, an aliased mapper and static method, argument-three receiver selection, and exactly two mapper arguments.
- Eight strict receiver values at all 13 callback sites: undefined, null, false, positive zero, negative zero, empty/nonempty strings, and NaN. No boxing, truthiness fallback, or signed-zero normalization is accepted.
- reduce/reduceRight without an initial value, with explicit undefined, and with an object accumulator plus repeatedly bound callback/prefix arguments. Initial value is not thisArg.
- Factory-created lexical arrows and repeatedly bound callbacks through aliases at array map, Array.from, Map, and Set sites. The frozen author suite additionally retains both comparator controls.
- Five active checkpoint/replay cases: array map, array forEach, Map, Set, and Array.from. Each runs multiple callbacks with two distinct receiver aliases, records identity before suspension, and checks identity after restoration. The author contributes another six active-checkpoint cases, so the focused run includes 11 total.

Validator-authored tests use strict bounded native evaluation and pure in-memory Promise stubs. They create no filesystem fixtures, do not perform guest real IO, and do not call an LLM. Configured repository-wide gates include the repository's existing integration fixtures and local stub services; this report does not claim those existing tests are all memory-only.

### Original CTX-001 evidence and baseline RED

The guard is installed from `inventory-verification.json` before any original payload read. It excludes all 38 exact paths and the complete security directory. Only five explicit files are read: the CTX controls/review result JSON files and sources 01-map-thisarg, 02-foreach-thisarg, and 03-map-explicit-call. There is no recursive archive search, excluded file byte/hash access, excluded execution, or original modification. Exact read accounting is in `out/safejs-remediation/ctx-001-validation/bootstrap.json`.

All three original sources are executed unchanged as strict native ESM before current-TypeScript execution. Two native runs, two current runs, and two completed replays per source give 18 complete successful comparisons. Every result field is retained, including receiver/source identity flags, indices, unchanged values/context, and positive zero. JSON evidence explicitly tags undefined, negative zero, and non-finite values rather than silently normalizing them. Full outputs are in `full-original-outputs.json`; complete executable/argv/stdout/stderr records are in `native-originals.json` and `current-originals.json` under the validator output directory.

The independent baseline replay reads all five production preimages directly from the pinned Git commit, verifies their hashes, and loads them through in-memory module hooks. No live source file or other clone is changed. On these genuine base bytes, original map-thisarg and forEach-thisarg reject with TypeError because the callback receiver is undefined; the entire explicit-call control still matches native. `baseline-originals.json` preserves all outcomes and loaded preimage hashes. This reproduces the actual original defect; it is not a claim to independently repeat the author's 78-failure/57-pass matrix count.

### Preserved failures and unresolved boundaries

No known failure is waived or turned into a passing product assertion.

1. **LANG-01 remains unresolved.** Native read-only nested map returns `[[1,2],[1,2]]`; this candidate still rejects with `SandboxError`, code `reentry`, message `Sandbox object is already running.`
2. **NUM-001 remains separate and unmerged.** Native source function arity is 2; this candidate returns undefined while the function call still returns 5. The prior NUM-001 validation from another workspace does not apply to this tree.
3. **Contextual-keyword identifier parsing remains unresolved.** Native `const from = Array.from; return from([3, 1]);` returns `[3,1]`; this tree rejects the `from` identifier. The parser is byte-identical to base, SHA-256 `ff3a5c360312d4fad9aeeb943ad34c8db01d68a807d889a414d073ab3495d645`.

All three native compatibility assertions genuinely fail in `known-unresolved-assertions.json` (exit 1). They are not counted as passing CTX tests, skipped tests, or repaired defects. This prevents passing configured gates from being misread as general compatibility approval.

The parser issue first caused six failures in the independent Array.from alias fixtures; the other 31 tests passed. The complete initial test and output remain in `initial-validation-test.ts.txt` and `dedicated-initial.json`. To reach the receiver checks, only the local identifier is renamed from `from` to `convert`, preserving alias behavior. No callback expectation is lowered. `assertion-preservation.json` uses TypeScript AST/printer comparison to confirm all 17 original assertion statements remain unchanged. The parser incompatibility is separately retained as a failing assertion, not hidden by that fixture adjustment.

Test-only typechecking initially reported eight accesses to `RunResult.returnValue` without TypeScript discriminant narrowing. `types-tests.json` and `pre-type-narrowing-test.ts.txt` preserve that failure. Explicit error-branch guards in the validator test resolve the type errors; existing success/value assertions remain unchanged. No production repair is involved.

### Configured commands and observed results

Run from `/Users/kjopek/Workspace/poe-code-safejs-callback-this`. Gates use `env -u TERM SKIP_SYNC_SKILLS=1 POE_SNAPSHOT_MODE=playback POE_SNAPSHOT_MISS=error`. Every command JSON records exact executable, argv, cwd, timeout, timestamps, exit, signal, full stdout, and full stderr.

- Build before types: `npm exec turbo run build -- --output-logs=errors-only` — 67/67 tasks pass, zero cache hits (`build.json`). Dependencies already exist; no install/upgrade or lockfile edit is performed.
- Final focused: `npm run test:unit -- packages/safejs/src/interp/methods/callback-this.test.ts packages/safejs/src/interp/methods/ctx-001-validation.test.ts --reporter=verbose` — 178 passed, zero skipped (`focused-exact-final.json`).
- Final package: `npm run test:unit -- packages/safejs/src packages/safejs/test` — 148 files passed, one skipped; 4,345 tests passed, 39 skipped, 4,384 total (`safejs-package-final.json`). No additional exclusion filter is applied.
- Full configured unit gate: `npm run test:unit` — 938 files passed, three skipped; 21,730 tests passed, 41 skipped, 21,771 total, zero failures, 228.64 seconds (`full-unit-final.json`). This is the unfiltered configured gate on the final source/test bytes; no new skips or exclusions are added. Full stdout and stderr are preserved.
- Root types: `npm run lint:types` — exit 0 (`types-root.json`).
- Package types: `node_modules/.bin/tsc -p packages/safejs/tsconfig.json --noEmit` — exit 0 (`types-safejs.json`).
- Both callback test files: `node_modules/.bin/tsc -p out/safejs-remediation/ctx-001-validation/tsconfig.tests.json` — final exit 0 (`types-tests-final.json`).
- Full repository ESLint: `npm run lint:eslint` — exit 0 (`eslint-root.json`). All six author TypeScript files plus the validator test are rechecked after the final type guards — exit 0 (`eslint-exact-final.json`).
- Prettier: all seven frozen author publishables plus validator test — exit 0 (`format-code-author-plan.json`). The final validator plan is separately formatted/checked before capture.
- `git diff --check` — exit 0 (`diff-check.json`). Tracked changes remain exactly the five frozen author production files.

The author's 141 focused, 4,308 package, and 21,693 full-suite passing counts remain separately hash-verified author evidence. Independent counts include 37 new tests. No CLI visual change is present, so screenshots do not apply. No E2E/release publication or fresh security research is claimed.

### Capture and integration boundary

The exact nine-file scoped candidate comprises seven frozen author publishables plus the independent test and this report. `out/safejs-remediation/ctx-001-validation/candidate/hash-manifest.json` records every postimage byte count/SHA-256, the five exact base preimages, and four paths absent at base. The original author manifest and validation outputs are preserved alongside the candidate. Candidate/evidence hashes bind the exact bytes; read-only permissions and macOS immutable flags protect only validator-owned captured output, never author files or other workspaces. The readiness handoff records the final protection verification.

The original untracked `packages/terminal-pilot/assets/` directory is not part of this candidate and is left alone. Build-generated files are not publishables. No Git commit, push, branch creation, stash, reset, README edit, production edit, or other task-workspace write occurs.

A scoped CTX-001 READY result is not overall remediation or compatibility readiness. LANG-01, unmerged NUM-001, and the parser failure remain open; array metadata is neither repaired nor claimed fixed. The future publisher must check preimages/overlaps, merge parallel interpreter changes without full-file overwrite, and obtain fresh independent validation of the combined result before publication.

# NUM-001 independent validation

## Boundary

- Validator worker: execute directly; no nested delegation required.
- Work only in `/Users/kjopek/Workspace/poe-code-safejs-function-arity`.
- Frozen author base: `bc85287c08cfa8796af80c76d0dd8dd2ddf7347b`.
- Author source, tests, plan, and evidence remain unchanged. No production edits, Git mutations, publisher work, README changes, other clones, guest real IO, LLM calls, or security probes.
- Own only `packages/safejs/src/interp/num-001-validation.test.ts`, this plan, and `out/safejs-remediation/num-001-validation/**`; write via apply_patch.

## Validation sequence

1. Verify exact author postimages, base preimages, and evidence hashes. Bootstrap inventory-verification.json metadata; enforce all 38 exclusions and the entire security directory before payload reads. Allow only root/numerics REPORT and the three handoff originals.
2. Establish bounded native full-original anchors before any current-TypeScript execution. Compare all return fields, not just descending indices.
3. Review AST first-default/rest derivation, supported source forms, binding, await transport, and restored source metadata. Add independent regression tests without widening supported syntax or reflection.
4. Run dedicated/focused tests, relevant non-adversarial broad coverage, typecheck, lint, formatting, and whitespace checks. Do not mutate frozen source to produce RED; author RED evidence is separately hash-verified.
5. On a scoped failure, preserve the failing test/output and hand off promptly for author repair. On READY, capture exact immutable candidate bytes and base preimages with SHA-256/byte manifest; require fresh validation after publisher integration of parallel interpreter patches.

## Result: READY for scoped integration review

NUM-001 source-function arity passes independent validation at the exact frozen base and postimages. This is not integrated-patch, whole-remediation, release, or publication approval. The publisher must merge known parallel interpreter changes by preimage-aware diffs and run fresh integrated validation. No publisher work occurs here.

### Frozen author and archive checks

- All nine author source/test/plan postimage hashes, byte counts, and base preimage hashes match `out/safejs-remediation/num-001/handoff.json`. Its SHA-256 is `7d9c11a869a1cf8248088eecacb09ea99825f1025ec0addac72e42dce65246f9`.
- All five declared author evidence hashes match, including RED 24 failed / 73 passed, GREEN 97 passed, and broad 797 passed. Those counts are author evidence, not an unfiltered independent rerun claim.
- The archive guard loads exactly 38 exclusions from `inventory-verification.json` and rejects the entire security directory before any payload read. Five allowed payloads only: root REPORT, numerics REPORT, and originals 08/10/11. No excluded bytes or refreshed excluded hashes, broad audit/family content search, or original-repository writes.
- Native full-original anchors were established before any current-TypeScript execution. TypeScript AST extraction independently verifies all three complete embedded author fixtures against the allowed originals.

### Independent implementation review

- `packages/safejs/src/parse/bindings.ts:21`: count formal parameters until the first top-level AssignmentPattern or RestElement; nested defaults/rest inside destructuring do not truncate the count. The helper only inspects AST kinds and cannot evaluate default expressions or computed binding keys.
- `packages/safejs/src/interp/async.ts:137`: ordinary, arrow, async, generator, and supported object-method construction use the same metadata derivation. Source methods already lower to function expressions; no new source syntax is introduced.
- `packages/safejs/src/interp/values.ts:179`: optional source length is defined as non-enumerable, non-writable, non-configurable metadata. Unannotated host/builtin closures retain their previous representation.
- `packages/safejs/src/interp/methods/function.ts:27`: member lookup exposes metadata after explicit properties. Binding subtracts positional arguments, not the receiver, and clamps at zero; repeat binding composes this calculation. Existing call/apply and constructor paths remain unchanged.
- `packages/safejs/src/snapshot/restore.ts:589`: restored source closures recompute length from their AST without changing the snapshot schema. Independent coverage verifies JSON serialization, restore, binding/rebinding without executing the source closure, await/Promise transport, and a completed-run in-memory dump/resume.
- General function property mutation/reflection, host/builtin signatures, unsupported snapshot forms, classes, async generators, and generator shorthand remain outside this validation. Retained bound closures are not newly promised as serializable. No collection or array-metadata repair is claimed.

### Independent tests and full originals

`packages/safejs/src/interp/num-001-validation.test.ts` adds 25 tests. The 14 parameter-list cases each check 15 supported source forms and seven direct/bound metadata results against native execution before SafeJS. Other cases cover side-effect-free derivation, identity/arity through await and fulfilled Promise paths, eight restored-source representations, and in-memory completed-run dump/resume. No test creates disk files, accesses a real guest capability, or calls an LLM.

All three unchanged originals match their complete native output, with no tolerance or selected-field projection. Descending indices are `[[5,7,5],[3,5,3],[1,2,1]]`; parent arities are 1/2; reduction arities are 2/1/1 and result is 5. Stable sorted IDs, all eight ascending query objects, captured-scale outputs, restricted bounds, and the full explicit-mode control are unchanged. Full native and current outputs, source hashes, and timestamps are in `out/safejs-remediation/num-001-validation/full-original-outputs.json`.

An additional independent baseline replay uses read-only `git show` preimages through in-memory module hooks: all five production preimages are hash-checked and loaded, without editing any frozen file or creating another clone. It reproduces all three complete author RED outputs, including nine zero descending indices and undefined ordinary/arrow/generator lengths. This is not a repeat of the author's 24-failure Vitest count. See `base-in-memory-verified.json` and `baseline-qualification.json` under the validation output directory.

### Commands and counts

Run from `/Users/kjopek/Workspace/poe-code-safejs-function-arity`. Every retained command JSON contains exact executable, argv, cwd, timeout, timestamps, exit status, signal, full stdout, and full stderr.

- Dedicated: `./node_modules/.bin/vitest run packages/safejs/src/interp/num-001-validation.test.ts --reporter=verbose` — 25 passed, 0 failed (`dedicated-supported.json`).
- Focused: the dedicated file plus frozen `interp/function-arity.test.ts`, `interp/methods/function.test.ts`, and `snapshot/restore.test.ts`, with the predeclared non-probe filter — 96 passed, 26 skipped, 0 failed across four files (`focused.json`). All author arity tests run.
- Broad: the author's exact 15-file set plus the dedicated file, with the same filter — 752 passed, 70 skipped, 0 failed across 16 files (`broad.json`). `suite-scope.json` records all 70 excluded existing test names and exact filter before execution. These conservative security/prototype/corrupt-snapshot/resource-limit exclusions honor the no-probes boundary; no tests were edited to weaken expectations. This run is not described as 822 or 797 independent passes.
- Source types: `./node_modules/.bin/tsc -p packages/safejs/tsconfig.json --noEmit` — exit 0 (`typecheck.json`).
- New test types: in-memory TypeScript program using package options plus the dedicated test root — exit 0 (`validation-test-types.json`); needed because package tsconfig normally excludes tests.
- ESLint: all eight frozen author TypeScript files plus the dedicated file — exit 0 (`eslint.json`).
- Prettier: the same nine TypeScript files — exit 0 (`prettier-code.json`). This plan is separately formatted and checked. Frozen author files are not formatted or rewritten.
- `git diff --check` — exit 0 (`diff-check.json`). No Git mutation, commit, push, branch, stash, reset, dependency change, or build/publisher artifact generation.
- No visual CLI changes; screenshot validation does not apply. No full repository, adversarial, E2E, or release suite is claimed.

To replay an exact captured command without creating a QA script, read its JSON and execute the recorded executable and argv from its recorded cwd. The focused/broad test-name filter is also available as `testNamePattern` in `suite-scope.json`.

### Retained non-blocking observations

The initial independent matrix combined async and computed shorthand as `({ async ["load"]() {} }).load`. It failed parsing before metadata evaluation (14 matrix failures; the other 11 tests passed). The unchanged base parser only recognizes identifier-named async shorthand. This unsupported combination is outside NUM-001; no new parser feature is demanded. The original test and complete failure remain in `initial-validation-test.ts.txt` and `dedicated.json`. The final matrix separately tests supported async named and synchronous computed methods, increasing the matrix from 14 to 15 forms without lowering any arity assertion. Parser base/current SHA-256: `ff3a5c360312d4fad9aeeb943ad34c8db01d68a807d889a414d073ab3495d645`. See `unrelated-observations.json`.

The first optional baseline driver demanded five loaded overrides, but ordinary run does not import low-level snapshot restore; four exact preimages loaded. The retained diagnostic and final driver explicitly importing low-level restore distinguish that driver-only accounting failure from product behavior. Final five-module replay succeeds. No failed driver is represented as a passing validation.

The author's pinned dependency audit warnings remain unremediated and were not independently re-audited. Known parallel interpreter/collection/array-metadata changes are not present or validated here. Source reflection and pre-existing snapshot limitations remain explicitly unpromised.

### Exact candidate and publication boundary

The validator output `candidate/manifest.json` captures an exact 11-file candidate: nine frozen author source/test/plan files and the two validator test/plan files. It records ownership, base existence, byte counts, SHA-256, and content-addressed exact postimage/preimage objects (seven existing base files, four new files). Author handoff/evidence and validation evidence are independently bound by the evidence manifest. Candidate objects are write-once for this validation; hashes detect any later change. Live source files are not substitutes for these frozen candidate bytes.

Publisher instructions: verify the base and candidate hashes, check overlaps against known parallel interpreter patches, merge diffs rather than overwrite full shared files, and obtain fresh integrated validation before any publication. This scoped READY result does not authorize publishing or claim the overall remediation is complete.

# Independent validation: MC-003

## Verdict and scope

**READY TO SHIP MC-003 in isolation.** This is independent validation, not the author Turing's self-certification. Final publication must occur only from a separate clean main clone after approval. This report does not authorize a push or certify the parallel remediation wave.

- Worktree: `/Users/kjopek/Workspace/poe-code-safejs-fixes`; branch `main`; HEAD `9ef2e738dc177eb2ac96358b1e1a0f9f40fe97dc`.
- Local validation date: August 28, 2026, America/Chicago. Retained evidence timestamps are August 29, 2026 UTC.
- Read ancestor `/Users/kjopek/Workspace/AGENTS.md` and target root `AGENTS.md`; no nested instructions were found under packages, docs, or out. Acting only in the assigned independent validation lane.
- The three author files remained frozen and byte-identical throughout. No production edits, Git mutations, stage/commit/push/pull, README, master-plan, or other-lane edits.

## Read-only audit bootstrap

Before reading payloads, load only `inventory-verification.json` metadata, extract and assert the exact 38 excluded paths, and exclude the entire security directory. The independently constructed reader rejects excluded paths before opening files. `out/safejs-remediation/mc-003-validation/bootstrap.json` retains the full exclusion list, metadata hash, allowed read log, and unchanged-input checks. The graph child independently repeats the bootstrap before its own payload reads.

Original audit root: `/Users/kjopek/Workspace/poe-code/out/safejs-audit-2026-08-27`. Archive/security bytes read: **0**. Archive/security probes executed: **0**. The audit was never written.

## Static review

The complete tracked diff in `packages/safejs/src/interp/globals/object-array.ts` adds only `NaN: Number.NaN`, `NEGATIVE_INFINITY: Number.NEGATIVE_INFINITY`, and `POSITIVE_INFINITY: Number.POSITIVE_INFINITY` to the existing Number property table. No new branching, capabilities, dependencies, coercion logic, array logic, or module behavior. All five existing numeric constants remain unchanged.

The author's 23 tests include graph algorithm/data anchors, but not the complete original import/factory workflow. This validator separately reran the actual original 4,906-byte, 134-line graph source, including all imports, asynchronous metric calls, factory aliases, scaling, bias, and route reconstruction. It was not replaced by the author's extracted workflow or by the compatible global-Infinity rewrite.

The eight numeric constant names were cross-checked against ECMAScript 2024 §21.1.2 (`https://tc39.es/ecma262/2024/multipage/numbers-and-dates.html#sec-properties-of-the-number-constructor`) and native Number numeric properties (excluding function arity `length`). Independent tests cover dot/computed lookup, exact finite values, NaN strict/loose/identity comparisons and propagation, both infinity signs, arithmetic, overflow, underflow, ordering, predicates, and signed zero. No complete ECMAScript descriptor/prototype conformance claim is made.

## Original graph: native expected first

1. Read the original graph, original fixture data, retained native projection, and manual expectations through the exclusion guard.
2. Assert the graph SHA-256 `ad3ff24fe77d0813d0e24def6984d52c1c6014e36fa9b3a5dfd5c0d795b7fc9b` and native SHA-256 `d4514704f9cce57ee740fa06b2d4cb5ba0e64586c76e5d927668224b30649119`.
3. Assert that the native projection changes only the final top-level `return ` to `export default `. The SafeJS source remains byte-for-byte original, including both `Number.POSITIVE_INFINITY` uses.
4. Assert the review fixture datasets and metric stdout are identical to the primary original fixtures. Construct the actual current-source `makeHarnessModule` and `makeMetricModule` factories with fresh state; the metric runner returns fixed in-memory strings only.
5. Run all four native ESM configurations and require full manual expected outputs and call traces before any SafeJS execution.
6. Run current `packages/safejs/src/run.ts` twice per configuration, with fresh factories and budgets; compare every distance, adjusted value, predecessor route, and call trace.

Native: **4/4 anchors pass**. SafeJS: **8/8 original graph payloads pass**, for `object-object`, `map-map`, `object-map`, and `map-object`. Each SafeJS run uses 4,316 steps.

| Graph | Native expected distances = actual | Native expected adjusted = actual | Native expected routes = actual |
| ----- | ---------------------------------- | --------------------------------- | ------------------------------- |
| alpha | [0, 6, 2, 8]                       | [1, 7, 3, 9]                      | [a], [a,c,b], [a,c], [a,c,b,d]  |
| beta  | [0, 9, 6, 15]                      | [2, 11, 8, 17]                    | [s], [s,u,t], [s,u], [s,u,t,v]  |

All calls match in order: alpha scale #1, beta scale #1, alpha bias #2, beta bias #2; metrics are [2,3,1,2]. Titles, labels, alias observations, and every other output field match native except the separately reported namespace identity flag.

The retained original failure has undefined distances for b/c/d/t/u/v, NaN adjusted values, and singleton routes. It is preserved as historical evidence, not presented as a newly executed pre-fix graph run.

**Do not claim full-output equality:** `imports.namespaceContainerSame` remains native true / SafeJS false in all eight runs (MC-002). The comparator explicitly records this difference and checks all other fields; it does not erase it from retained outputs.

**Do not cross-claim MC-001:** original-source lint has zero errors and one `AS-UNUSED-IMPORT` warning for `betaPlan`. No compatible global-Infinity rewrite or actual `runHarness` gate was executed. Runtime global Infinity/NaN checks in unit tests do not certify global-name lint. MC-001 remains owned by its separate worker.

## Commands and results

Commands run from the target worktree. Full executable/argv/cwd/timeout/stdout/stderr are retained in the evidence JSON files; no executable QA script was added.

### Focused tests

`node_modules/.bin/vitest run packages/safejs/src/interp/globals/number-mc-003-validation.test.ts packages/safejs/src/interp/globals/number-mc-003.test.ts`

Exit 0: **79/79**, two files, 1.30 seconds. The validator contributes 56 tests; the author contributes 23. Each independent numeric runtime assertion first runs its native expression against an explicit expected value. `toBe` uses identity-aware comparison rather than JSON conversion, preserving NaN and signed zero distinctions.

### Relevant broader tests

`node_modules/.bin/vitest run packages/safejs/src/interp/globals/number-mc-003-validation.test.ts packages/safejs/src/interp/globals/number-mc-003.test.ts packages/safejs/src/interp/globals/object-array.test.ts packages/safejs/src/interp/globals/math.test.ts packages/safejs/src/interp/globals/misc.test.ts packages/safejs/src/interp/methods/number.test.ts packages/safejs/src/modules/harness.test.ts packages/safejs/src/modules/metric.test.ts packages/safejs/src/modules/registry.test.ts`

Exit 0: **174/174**, nine files. Initial run: 2.46 seconds. Final GREEN after the memory-only negative control: 3.19 seconds. No whole-unit-suite race with other workers' RED tests.

### Independent regression sensitivity

Run the retained inline Vitest command in `out/safejs-remediation/mc-003-validation/sensitivity.json`. A Vite pre-transform removes only the three added constant registrations **in memory**, without writing production files. Native oracles remain unmodified.

Expected exit 1: **29 failed / 27 passed**, 56 total, 996 ms. Exactly one source transform occurred; the frozen source hash stayed unchanged. This is a deliberate negative control, not a failure of the current product. The final unmodified-source broader run returns to 174/174 GREEN. No author RED evidence is substituted for this check, and no new production change was made.

### Typecheck, lint, format

- `node_modules/.bin/tsc -p packages/safejs/tsconfig.json --noEmit`: exit 0. Package config excludes test files.
- `node_modules/.bin/eslint packages/safejs/src/interp/globals/object-array.ts packages/safejs/src/interp/globals/number-mc-003.test.ts packages/safejs/src/interp/globals/number-mc-003-validation.test.ts`: exit 0.
- `node_modules/.bin/prettier --check packages/safejs/src/interp/globals/object-array.ts packages/safejs/src/interp/globals/number-mc-003.test.ts packages/safejs/src/interp/globals/number-mc-003-validation.test.ts docs/plans/safejs-fix-mc-003.md`: exit 0.
- `git diff --check -- packages/safejs/src/interp/globals/object-array.ts packages/safejs/src/interp/globals/number-mc-003.test.ts packages/safejs/src/interp/globals/number-mc-003-validation.test.ts`: exit 0; tracked diff check, not a claim that untracked files are included by Git.

### Original graph execution

Actual invocation: `/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node --experimental-vm-modules --import tsx/esm --input-type=module -e <retained inline driver>`, with a 30-second child timeout. The complete driver is `out/safejs-remediation/mc-003-validation/graph-original.json` at `execution.args[5]`; source hashes, expected outputs, actual outputs, lint diagnostics, and call traces are retained. Exit 0. The only stderr is Node's experimental VM-module warning.

To reproduce after inspecting the retained command, execute this as an agent-directed step:

```sh
node --experimental-vm-modules --import tsx/esm --input-type=module -e "$(node -e 'const evidence = require("./out/safejs-remediation/mc-003-validation/graph-original.json"); process.stdout.write(evidence.execution.args.at(-1))')"
```

The first driver attempt passed all four native anchors but stopped at the first SafeJS comparison because `deepStrictEqual` distinguishes SafeJS null-prototype objects from native ordinary objects. This was a validator comparator defect, not graph arithmetic failure. Corrected only the in-memory comparison driver to apply `structuredClone` to both outputs before comparison, preserving NaN, infinities, signed zero and undefined. Raw first-attempt stdout/stderr and the original driver remain in `out/safejs-remediation/mc-003-validation/graph-comparator-correction.json`; nothing was overwritten or hidden.

## Bounds and limits

- Native ESM timeout: 2,000 ms per evaluation. SafeJS limits: 100,000 steps, depth 64, string length 32,768, array length 4,096, data size 2 MiB, deadline 2,500 ms. Child hard timeout: 30 seconds. Original graphs have four vertices and five edges each.
- Independent numeric VMs use 1,000 ms timeouts; SafeJS numeric budgets are 100 or 1,000 steps. Unit tests perform no filesystem operations; no memfs is necessary. Host-only audit reads and evidence creation are not guest capabilities.
- No LLM, real metric script, guest network, guest external filesystem IO, archive/security workload, source dist build, full repository suite, E2E, release build, publish, or actual harness gate.
- No visual CLI change, so screenshots are not applicable. Typecheck does not statically typecheck the new tests; Vitest compilation/execution and ESLint do cover them.
- Parallel COLL, STR03, TREE01, and MC001 code is not certified. Results use the current shared TypeScript worktree; final integration/release validation belongs in the approved clean main clone.

## Frozen file hashes

All SHA-256 values were checked before and after validation:

- `packages/safejs/src/interp/globals/object-array.ts`: `7addf2003ce301bc2ef24ddac6e7de9737c0a8dae934be64b49631bd45da9d5f`.
- `packages/safejs/src/interp/globals/number-mc-003.test.ts`: `95b881ebbe78cf8738a4c0b780ed92b3ed96a9cc8c610dc02718f40c41c2c60f`.
- `docs/plans/safejs-fix-mc-003.md`: `94491cdd98335476746d4f265a35eaf7f4649de2e311b2cb78d815851ce6de92`.

Validator test SHA-256: `a8c83439a268c9c86cf98aa791574264070635adcf7440625496d1bbb0d2636b`.

## Exact validator-created paths

- `packages/safejs/src/interp/globals/number-mc-003-validation.test.ts`
- `docs/plans/safejs-validate-mc-003.md`
- `out/safejs-remediation/mc-003-validation/bootstrap.json`
- `out/safejs-remediation/mc-003-validation/graph-original.json`
- `out/safejs-remediation/mc-003-validation/graph-comparator-correction.json`
- `out/safejs-remediation/mc-003-validation/sensitivity.json`
- `out/safejs-remediation/mc-003-validation/checks.json`
- `out/safejs-remediation/mc-003-validation/validated-hashes.json`

No author file was edited. Evidence JSON is retained command/output data; the validation procedure is this Markdown plan.

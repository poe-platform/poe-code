# MC-003: Standard Number constants

## Scope and ownership

- Worktree: `/Users/kjopek/Workspace/poe-code-safejs-fixes`.
- Starting revision: `9ef2e738dc177eb2ac96358b1e1a0f9f40fe97dc`.
- Original repository is read-only; no Git mutations, commits, or pushes.
- Authorized changes: this plan, `packages/safejs/src/interp/globals/number-mc-003.test.ts`, and only the Number numeric-constant block in `packages/safejs/src/interp/globals/object-array.ts`.
- Numeric globals actually live in `object-array.ts`, not `number*`. The user explicitly expanded the allowlist after the author RED run and granted exclusive ownership of the Number constants portion. OBJ-001/OBJ-003 and all other object/array behavior remain out of scope.
- Do not change the shared globals index, interpreter, iteration, strings, regex, README, or other workers' files. Independent validation remains separate.

## Audit bootstrap and contract

Read ancestor and repository AGENTS instructions. Before reading family payloads, loaded the original audit's `out/safejs-audit-2026-08-27/inventory-verification.json`, verified its exact 38 `archiveReadPolicy.excludedPaths`, and blocked those paths plus the entire security directory. No archive payload reads, hashes, executions, or security probes.

Original audit anchors under `out/safejs-audit-2026-08-27`:

- `REPORT.md:455`: MC-003 priority and express numeric-constant contract; original alpha distances `[0,6,2,8]` and beta `[0,9,6,15]`.
- `module-composition/examples/graph.safejs`: original heap, relaxation, predecessor traversal, and both Number infinity references. Regression embeds the unchanged numeric workflow, omitting unrelated module identity checks and host factories.
- `module-composition/fixtures.json`: both original finite positive graph inputs and metric scale/bias values.
- `module-composition/manual-expected.json`: exact distances, adjusted values, and routes; native execution alone is not the truth source.
- `module-composition/REPORT.md`: historical original failure and full Infinity-rewrite control. Its historical compatibility classification is superseded by the root report's express-contract assessment.

Current contract: `packages/safejs/README.md:154` explicitly promises standard numeric constants. Local TypeScript declarations enumerate five Number constants in `node_modules/typescript/lib/lib.es5.d.ts:588` and three more in `node_modules/typescript/lib/lib.es2015.core.d.ts:213`.

## Root cause and fix

`createObjectArrayGlobals` explicitly registers five finite Number constants but omits `NaN`, `NEGATIVE_INFINITY`, and `POSITIVE_INFINITY` from the same property table. Missing positive infinity initializes graph distances to undefined, preventing relaxation and losing predecessors. This is not an iteration or module-composition fix.

After write-claim approval, added all three omitted native numeric values to that existing property table. Preserved all five finite constants, predicates, coercion, parsing, and the global Infinity/NaN bindings. No numeric module or unrelated globals refactor was introduced merely to fit the initial filename claim.

## Author TDD and validation

1. Run `node_modules/.bin/vitest run packages/safejs/src/interp/globals/number-mc-003.test.ts` before production edits.
2. Confirm missing values and exact graph failures while existing finite numeric behavior and the global-Infinity graph controls pass.
3. Obtain the explicit write claim, make the minimal three-constant fix, and rerun the same tests to GREEN.
4. Run neighboring numeric/global tests and relevant TypeScript checks, recording actual outcomes without modifying other workers' files.
5. Hand off the changed paths, actual RED/GREEN evidence, broader checks, and residual risks to the independent validator.

The native oracle runs fixed numeric/graph snippets in a fresh VM context with a 1,000 ms timeout; SafeJS uses explicit 100/1,000/20,000-step budgets. Inputs contain at most five vertices and five edges. Tests perform no filesystem operations, external guest IO, or real LLM calls. Direct numeric assertions preserve NaN, signed zero, and infinities without JSON result serialization. No visual CLI changes occur, so screenshots are not applicable.

## Execution record

- Author RED: `node_modules/.bin/vitest run packages/safejs/src/interp/globals/number-mc-003.test.ts` exited 1: 10 failed, 13 passed (23 total; 228 ms test time). Six failures show missing constants at registration/runtime, one shows special-value arithmetic damage, two show the original graph corruption, and one shows disconnected-vertex sentinel corruption. Both original global-Infinity graph controls and existing finite numeric checks passed. All native graph/manual-anchor comparisons passed before their SafeJS assertions.
- User granted the expanded write claim after RED. Production change adds exactly `NaN`, `NEGATIVE_INFINITY`, and `POSITIVE_INFINITY` to the existing Number property table.
- Author GREEN: the same focused command exited 0 with 23/23 tests passing (274 ms test time). Both original graphs now match all manual/native distances, adjusted values, and predecessor routes; the disconnected vertex retains infinity.
- Pre-fix neighboring baseline: 69/69 tests passed across `globals/object-array.test.ts`, `globals/math.test.ts`, `globals/misc.test.ts`, and `methods/number.test.ts`.
- Post-fix broader run: `node_modules/.bin/vitest run packages/safejs/src/interp/globals/number-mc-003.test.ts packages/safejs/src/interp/globals/object-array.test.ts packages/safejs/src/interp/globals/math.test.ts packages/safejs/src/interp/globals/misc.test.ts packages/safejs/src/interp/methods/number.test.ts` exited 0: 92/92 tests across five files (1.80 s total).
- `node_modules/.bin/tsc -p packages/safejs/tsconfig.json --noEmit` passed. This package configuration excludes test files; the dedicated test file additionally passed ESLint and Vitest compilation/execution.
- ESLint passed for both changed TypeScript files. Prettier passed for both TypeScript files and this plan after one formatting-only adjustment. Scoped `git diff --check` passed.

## Independent validation handoff

Ready for a separate validator; author checks are not independent validation. Re-run the focused and broader commands above and confirm that the production diff changes only the three constant registrations. The full SafeJS/repository suite was not run; unrelated worker validation and all locked files remain untouched by this worker.

Risk is low and confined to making three documented properties available through the existing property table. Regression coverage preserves finite constants, existing coercion/predicates/parsing, global-Infinity graph behavior, NaN/infinities/signed zero, both original graph anchors, and a disconnected-vertex control. No new runtime dependency, host capability, iteration change, module identity change, or object/array fix is included.

# SafeJS filesystem type-contract validation

## Problem and change

The full maintained unit run on `aae3b741f1a55ad0ec4cacaa5e87bc84648a187b` failed only the NodeNext Node-only filesystem type-contract profile at 5,121ms against its 5,000ms Vitest deadline. The unchanged four-profile replay passed, but that profile still took 4,916ms. These checks run the TypeScript compiler against declarations and consumer types; they belong in the explicit type-validation gate.

Move the checks to `packages/safe-js/scripts/check-fs-type-contract.mjs`, run by `npm run typecheck:contracts --workspace=@poe-code/safe-js`. Root `lint:types` runs the existing `tsc -p tsconfig.build.json --noEmit` first, then this workspace command. Root `typecheck` and full `lint` therefore include the contract gate.

`npm test` alone no longer executes these four compiler profiles. Validation requires the maintained type/lint gate as well as unit tests. No runtime code, compiler options, timeout settings, workflow, or lifecycle hooks change. This is a validation-route relocation, not a claim that compilation became faster.

## Preserved coverage

- Extract all three aliases (`FsOperationName`, `FsImplementation`, `FsModuleOptions`) from current `src/modules/fs.ts`; assert the complete extraction.
- Preserve all 25 cases: 11 valid and 14 invalid structural option assignments.
- Compile each case in all four combinations of NodeNext/Bundler and Node-only/DOM: 100 case decisions, including 44 acceptances and 56 rejections.
- Create a fresh compiler host and program per profile, with strict checking, `skipLibCheck: false`, and all pre-emit diagnostics.
- Keep both virtual files under `src/modules`, preserving relative import resolution. Virtual files remain in memory.
- Reject unexpected diagnostics and retain each named case assertion. Print profile, case count, and elapsed time.

## Validation evidence

- Full-run RED: `/tmp/poe-split-clock-unit.log`, one SafeJS failure; 21,666 SafeJS tests passed. No full-gate success claimed.
- Unchanged focused replay: `/tmp/poe-fs-type-contract-replay.log`, 4/4 passed; NodeNext Node-only 4,916ms, NodeNext DOM 3,605ms, Bundler Node-only 2,961ms, Bundler DOM 4,704ms.
- Before deleting the original test, external in-memory fault injection exercised its original assertion structure. The same controls exercised the new gate: missing alias, permissive `any`, restrictive `never`, and an unresolved type. Both implementations rejected all four faults (8/8 expected refusals), respectively at alias count, invalid-case acceptance, valid-case rejection, and unexpected diagnostics. Source files were never mutated for these controls. The external adapter normalizes cross-realm diagnostic arrays for assertion comparison; it does not change compiler results.
- Control driver: `/tmp/poe-fs-contract-controls.cjs`; original source capture: `/tmp/poe-fs-original-type-contract.ts`. Receipts: `/tmp/poe-fs-contract-original-controls.log` and `/tmp/poe-fs-contract-new-controls.log`.
- Actual package gate: `npm run typecheck:contracts --workspace=@poe-code/safe-js`, Node 22.23.2, exit 0. All four profiles passed: 2,112.8ms, 2,033.3ms, 1,274.1ms, 1,958.7ms. Receipt: `/tmp/poe-fs-contract-positive.log`.
- Root `npm run lint:types` passed with the new wiring, including root TypeScript checking and all four 25-case contract profiles. Receipt: `/tmp/poe-contract-gate-lint-types.log`.
- Maintained `npm run lint:eslint` passed: 10,761 configured and linted files, zero errors and warnings. `npm run lint:workflows` also passed. Receipts: `/tmp/poe-type-contract-eslint-result.json` and `/tmp/poe-type-contract-workflows-result.json`.

Maintained unit qualification remains a separate gate. No release or delivery is implied by these results.

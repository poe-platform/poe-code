# Generator allocation order — 2026-09-13

Six independent regressions fail before repair: ordinary/async generator prototype
replacement, intrinsic fallback and repeated checkpoint replay. ECMA-262 edition16
sections15.5.2/15.6.2 require FunctionDeclarationInstantiation before instance allocation.
The implementation selected the prototype before default parameters ran, following V8
rather than the pinned specification. Exact edition text is saved in pinned-spec.txt.

The instance prototype is now selected after parameter initialization. Retention tracks
the current replaceable prototype during initialization, then the selected prototype.
Six existing native-oracle/retention expectations initially failed after correction;
the two graph and two replay cases now explicitly assert the edition's result. The two
retention checks retain the replacement object and keep their existing100000-byte budget
and greater-than10000 assertion. Throw-path release assertions remain intact. An initial
attempt failed those retention assertions, retained in green-final.log; final96 tests pass.
No limits, assertions, runtime support or timeouts were weakened.

```sh
npx vitest run packages/safe-js/src/interp/generator-allocation-order.test.ts
npx vitest run packages/safe-js/src/interp/generator-allocation-order.test.ts packages/safe-js/src/interp/generator-intrinsic-prototypes.test.ts
npx vitest run packages/safe-js/src/interp/generator-allocation-order.test.ts packages/safe-js/src/interp/generator-intrinsic-prototypes.test.ts packages/safe-js/src/interp/generator-reentry-qualification.test.ts packages/safe-js/src/snapshot/guest-generator-for-continuations.test.ts
npx eslint packages/safe-js/src/interp/async.ts packages/safe-js/src/interp/generator-intrinsic-prototypes.test.ts packages/safe-js/src/interp/generator-allocation-order.test.ts
npm run build:workspaces -- --workspace=@poe-code/safe-js
```

Final lint and maintained build pass. The initial build's TypeScript prototype-union
annotation error is preserved in build.log and corrected in build-final.log. The first
upstream report passed before retention adjustment. A rerun during build aborted with
complete:false; it is not counted. upstream-built.jsonl is the final stable built-source
run: all original fixtures and recorded neighbors pass, with zero unsupported/errors.
Exact counts, SHA/fingerprint/patch, source hashes, modes and command are recorded in
reconciliation.json. Test262419d3e0a2273ba01a3bfcbec423f2801425b8e93, edition16/edition12,
Node22.23.2/ICU78.2 and3000ms/10000ms deadlines remain pinned.

SDK probes pass Node18.18.0/ICU73.2,18.20.8/74.2,20.20.0/77.1,22.23.2/78.2,
24.14.0/78.2,26.8.2/78.3 and Bun1.3.11/74.2, with original and three pending/completed
replays, generator progress, exact saved source and dynamic-constructor host denial.
The CLI screenshot was inspected and agrees with SDK. Commands/results are retained.

Eight original variants are repaired; residual arithmetic becomes130 nonpasses. Excluded
proposal cases remain failed/excluded, never passes. Whole-task acceptance and publication
remain open, with shared dependency setup and separate delivery/publication receipts.

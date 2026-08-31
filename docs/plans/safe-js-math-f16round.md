# SafeJS Math.f16round

## Scope and baseline

- Workspace: `/Users/kjopek/Workspace/poe-code-safejs-publish-rename`.
- `main` at `7fbbd81fd99c46928bcf314ad89410b946d203cc`; safe fast-forward pull reported already up to date.
- Confirmed no `f16round` implementation in `packages/safe-js/src`; Math currently registers native `fround` only.
- Original implementation scope: `packages/safe-js/src/interp/globals/math.ts`, `packages/safe-js/src/interp/globals/math-f16round.test.ts`, and this plan.
- Authorized follow-up: only the expected completed graph in `packages/safe-js/src/interp/regex/compile-policy.test.ts` and this plan; no further production changes.
- Preserve other authors' changes. No array/string/parser/README edits, dependencies, build, install, commit, push, or skill sync.

## Required behavior

Primary source: current ECMAScript specification, section 21.3.2.18, `Math.f16round`, at `https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-math.f16round`.

Apply ToNumber once, preserve NaN, infinities and signed zero, and round binary64 directly to binary16 using nearest/ties-to-even before returning a Number. The specification explicitly warns against binary32 intermediate double-rounding.

Use the existing named sandbox Math closure and interpreter budget path. Numeric work must have a small fixed bound, with no native `Math.f16round`, Float32 intermediate, eval, additional host capability, or dependency. Node 18.18.2 and 22.22.2 lack native `f16round`; Node 24.14.0 provides a differential oracle.

## Execution

1. Add memory-only boundary, coercion, exhaustive finite-value/midpoint, native-oracle, and interpreter-budget tests; run before implementation for genuine RED.
2. Implement a private Math helper using exact power-of-two scaling and explicit ties-to-even; register it in the existing method table.
3. Run focused and existing Math tests on Node 18.18.2, 22.22.2, and 24.14.0; check scoped lint and diff.
4. Record exact commands, counts, runtime behavior, and final changed paths for independent review.

## Validation evidence

### Implementation bound

The private helper applies unary `+` once, matching ToNumber (including rejection of BigInt and Symbol) and the existing Math coercion convention. It handles nonfinite values and signed zero first, then returns signed infinity at magnitude 65520 or above. Remaining magnitudes select their binary16 quantum with at most 29 exact doublings, starting at the subnormal spacing `2 ** -24`. Power-of-two scaling, integer/fraction separation, and parity implement nearest/ties-to-even directly; sign restoration preserves negative underflow zero. There is no logarithm, binary32 conversion, per-call buffer allocation, or native f16round dependency.

### RED and GREEN

Before implementation, the new test file reported **58 failed, 1 skipped** on Node 22.22.2. Its closure-presence assertion observed `undefined`; numeric and interpreter calls failed without the method. The native-oracle test was skipped because that runtime lacks it. A detached-call test's syntax was corrected to a supported single-statement arrow call during test bring-up.

```sh
node node_modules/vitest/vitest.mjs run packages/safe-js/src/interp/globals/math-f16round.test.ts --reporter=dot --no-cache
```

Final runtime matrix, including the existing Math regression file:

| Runtime      | Passed | Skipped | Total tests | Test execution | Whole run |
| ------------ | -----: | ------: | ----------: | -------------: | --------: |
| Node 18.18.2 |     94 |       1 |          95 |         123 ms |    498 ms |
| Node 22.22.2 |     94 |       1 |          95 |         108 ms |    434 ms |
| Node 24.14.0 |     95 |       0 |          95 |          95 ms |    397 ms |

There are 59 new tests and 36 existing Math tests. The only skip is the native differential oracle on Node 18/22. Each runtime independently checks all **63,488 signed finite binary16 values** and **190,464 signed midpoint/adjacent-binary64 cases**, including the overflow midpoint and its immediate binary64 neighbors. Node 24 additionally checks **16,384 deterministic binary64 inputs** against its actual native implementation. Explicit cases cover coercion, signed zero, nonfinite values, subnormals, ties, overflow, and both double-rounding directions. Interpreter checks cover direct/detached calls, snapshots, and step-budget exhaustion. Tests use only memory and no LLM or filesystem fixtures.

```sh
for version in 18.18.2 22.22.2 24.14.0; do
  /Users/kjopek/.nvm/versions/node/v$version/bin/node node_modules/vitest/vitest.mjs run packages/safe-js/src/interp/globals/math-f16round.test.ts packages/safe-js/src/interp/globals/math.test.ts --reporter=dot --no-cache || exit 1
done
```

### Scoped checks

All pass; the TypeScript check emits no files. No full build, installation, commit, push, or skill sync was performed. No CLI visual behavior changes, so no screenshots are needed. Other authors' files remain untouched.

```sh
node node_modules/prettier/bin/prettier.cjs --check packages/safe-js/src/interp/globals/math.ts packages/safe-js/src/interp/globals/math-f16round.test.ts docs/plans/safe-js-math-f16round.md
node node_modules/eslint/bin/eslint.js packages/safe-js/src/interp/globals/math.ts packages/safe-js/src/interp/globals/math-f16round.test.ts
node node_modules/typescript/bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck packages/safe-js/src/interp/globals/math.ts packages/safe-js/src/interp/globals/math-f16round.test.ts
git diff --check -- packages/safe-js/src/interp/globals/math.ts packages/safe-js/src/interp/globals/math-f16round.test.ts docs/plans/safe-js-math-f16round.md
```

### Legacy checkpoint expectation repair

After independent Math approval, reproduced the named checkpoint test on Node 18.18.2: **1 failed, 33 filtered skips**, with exactly the new `Math.f16round` binding in the expected/actual diff. Added a separate `expectedCompleted` value by copying the legacy completed snapshot, its bindings, and Math object, then explicitly adding `{ kind: "fn", name: "f16round" }`. Both original pending/completed captures remain unchanged replay inputs. Full graph comparisons, hashes, regex alias/state checks, host-call assertions, and input/capture immutability assertions remain intact; no output stripping or normalization.

GREEN on Node 18.18.2 and 22.22.2: **136 passed, 2 native-only skips** each across all 34 compile-policy tests and 104 Math-focused tests (including the independent file). Node 24.14.0 Math-focused: **104 passed, 0 skipped**. Scoped Prettier, ESLint, and diff whitespace checks pass. Only the authorized test and this plan changed in this repair; no production/capture changes, build, install, commit, push, or home sync.

```sh
/Users/kjopek/.nvm/versions/node/v18.18.2/bin/node node_modules/vitest/vitest.mjs run packages/safe-js/src/interp/regex/compile-policy.test.ts --testNamePattern 'CONTROL genuine EA pending and completed regex checkpoints retain hash and graphs' --reporter=dot --no-cache
for version in 18.18.2 22.22.2; do
  /Users/kjopek/.nvm/versions/node/v$version/bin/node node_modules/vitest/vitest.mjs run packages/safe-js/src/interp/regex/compile-policy.test.ts packages/safe-js/src/interp/globals/math.test.ts packages/safe-js/src/interp/globals/math-f16round.test.ts packages/safe-js/src/interp/globals/math-f16round.independent.test.ts --reporter=dot --no-cache || exit 1
done
/Users/kjopek/.nvm/versions/node/v24.14.0/bin/node node_modules/vitest/vitest.mjs run packages/safe-js/src/interp/globals/math.test.ts packages/safe-js/src/interp/globals/math-f16round.test.ts packages/safe-js/src/interp/globals/math-f16round.independent.test.ts --reporter=dot --no-cache
```

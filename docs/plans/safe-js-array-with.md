# Bounded Array.prototype.with

## Baseline and ownership

- Workspace: `/Users/kjopek/Workspace/poe-code-safejs-publish-rename`.
- `git pull --ff-only` reported already up to date at main
  `7fbbd81fd99c46928bcf314ad89410b946d203cc`; unrelated untracked files remain untouched.
- `with` is already registered and implemented. Existing `array.test.ts` covers
  replacement/nonmutation, sparse densification, basic index coercion and range errors;
  `lang-01-validation.test.ts` covers nested read combinations.
- Missing: range/length-budget preflight before copying, skipping the replaced source
  slot, interpreter-owned indexed copying rather than host iterator dispatch, and
  bounded copy traversal.
- Production ownership: `packages/safe-js/src/interp/methods/array.ts`, only the `with` case.
- Test ownership: new `packages/safe-js/src/interp/methods/array-with.test.ts`.
- Plan ownership: this file. No metadata change is needed. No Math, values,
  interpreter core, README, sibling method, dependency, or publication changes.

## Contract

Primary references consulted via web:

- `https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.prototype.with`
- `https://tc39.es/ecma262/multipage/abstract-operations.html#sec-tointegerorinfinity`

Capture length, normalize the index with the existing coercion helper, resolve negative
indices, then reject out-of-range indices before allocating or reading elements.
Preflight the output length against the existing budget. Copy indexed own elements
into a fresh dense array, substituting the supplied value without reading that source
slot. Missing own elements become undefined, matching sandbox own-property reads;
host prototypes and iterators are not guest capabilities. Preserve shallow references
and existing produced-value validation. Charge copy traversal through the existing
step/deadline budget. Missing arguments become undefined; extra arguments remain
evaluated by the interpreter but unused by the method. General object coercion and
generic non-array receivers remain governed by the existing interpreter model.

## TDD and review

1. Add fast in-memory direct-method and interpreter regressions, with explicit expected
   results rather than native `Array.prototype.with`, eval, or Function oracles.
2. Run the new test file before production edits and record genuine failures.
3. Change only the `with` implementation and rerun the tests to GREEN.
4. Run adjacent array regressions, formatting checks for new files, and scoped diff
   checks. No CLI visual behavior changes; no screenshot validation is needed.
5. Record exact RED/GREEN evidence for independent review. Do not build, install,
   commit, push, sync skills, or publish; publishing belongs to remote CI.

## Results

- RED, before production edits: the new file reported **10 failed / 31 passed**
  in 401 ms (28 ms test execution). Failures exposed replaced-slot reads,
  range and array-length preflight ordering, host iterator/prototype reads,
  and missing step/deadline checks.
- The first implementation passed 40/41 tests. The remaining deadline test
  incorrectly assumed every visit checks the clock. It now primes the existing
  1,024-visit sampling boundary using public `visitNode()` calls before the copy;
  neither budget implementation nor deadline policy was changed.
- GREEN: **41/41 passed**, 462 ms total (25 ms test execution).
- Adjacent regression run: **450/450 passed across seven files**, 1.25 s total:
  `array.test.ts`, `array-with.test.ts`, `array-callback-mutation.test.ts`,
  `array-callback-replay.test.ts`, `array-nested-reads.test.ts`,
  `lang-01-validation.test.ts`, and `run.array-own-metadata.test.ts`.
- Scoped ESLint passed for both TypeScript files. Prettier passed for the new
  test and this plan. `git diff --check` passed.
- Runtime was Node v22.22.2. The new tests use explicit expectations and never
  call native `Array.prototype.with`; Node 18 was not separately executed.
- Production diff is restricted to the `with` case: captured length, range
  validation before copy, array-length preflight, and an own-index copy loop
  charging one visit per position. Existing coercion and output validation remain.
- Concurrent Math files and all unrelated files were left untouched. No build,
  install, commit, push, home sync, subagent, or publication was performed.

Focused rerun:

```sh
node_modules/.bin/vitest run packages/safe-js/src/interp/methods/array-with.test.ts --reporter=dot
```

Regression rerun:

```sh
node_modules/.bin/vitest run \
  packages/safe-js/src/interp/methods/array.test.ts \
  packages/safe-js/src/interp/methods/array-with.test.ts \
  packages/safe-js/src/interp/methods/array-callback-mutation.test.ts \
  packages/safe-js/src/interp/methods/array-callback-replay.test.ts \
  packages/safe-js/src/interp/methods/array-nested-reads.test.ts \
  packages/safe-js/src/interp/methods/lang-01-validation.test.ts \
  packages/safe-js/src/run.array-own-metadata.test.ts --reporter=dot
```

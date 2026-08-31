# Node 18 array oracle portability

## Ownership and baseline

Workspace: `/Users/kjopek/Workspace/poe-code-safejs-publish-rename`.

Only these test files and this plan are owned for this task:

- `packages/safe-js/src/interp/methods/array-callback-mutation.test.ts`
- `packages/safe-js/src/interp/methods/array-nested-reads.test.ts`
- `packages/safe-js/src/interp/methods/lang-01-validation.test.ts`
- `packages/safe-js/src/interp/methods/callback-this.test.ts`
- `docs/plans/safe-js-node18-array-oracles.md`

The reviewer log `out/math-array-validation/node18-safejs.log` identifies 20
native-array-oracle failures: 1 comparator mutation, 12 comparator nested readers,
6 alias/nonmutating/recovery cases, and the twentieth in `callback-this.test.ts`:
`ignores extra toSorted comparator receiver arguments`. Its native `toSorted`
call fails for the same missing-method reason, so it is included under the
explicitly allowed additional-array-test scope. Other log failures are excluded.

Production Array/Math, README, reviewer tests, and unrelated changes remain
untouched. No shared test harness, polyfill, dependency, build, install, commit,
push, home sync, or publication changes are authorized.

## Changes

1. Reproduce RED using the existing Node 18.18.2 runtime and only the four owned
   test files before editing them.
2. Replace native-only expected values in the affected parameterized groups with
   explicit fixtures. Always execute and check guest results against fixtures,
   including on newer runtimes with native copying methods.
3. Retain native differential assertions after the guest assertions, gated only
   by availability of the particular array method. Native failures propagate;
   no test skips, swallowed failures, or fallback implementations are introduced.
4. Preserve guest programs, replay/restore checks, aliases, sparse arrays,
   mutation, recovery, and extra-argument receiver assertions. Fixtures must not
   depend on comparator order or number of calls.
5. Verify the identical bounded test set on Node 18.18.2 and Node 22.22.2, check
   scoped formatting/lint/diffs, and record commands for Rawls's independent review.

## Evidence

- RED: Node 18.18.2, **20 failed / 494 passed**, four failed files, 1.50 s total.
  This matches all 20 native-array failures identified in the reviewer log.
- GREEN after formatting: **514/514 passed, four files, zero skipped**, on both
  Node 18.18.2 (1.46 s total) and Node 22.22.2 (1.19 s total).
- Per-file test counts, unchanged on both runtimes: `array-callback-mutation`
  130, `array-nested-reads` 202, `lang-01-validation` 41, `callback-this` 141.
- Runtime capability probes confirmed `toSorted`, `toReversed`, `toSpliced`, and
  `with` are undefined on Node 18.18.2 and functions on Node 22.22.2. Thus the
  latter run exercises both unconditional fixtures and native differentials;
  the former still runs every guest assertion, including restored replay.
- Scoped Prettier, ESLint, and `git diff --check` passed. Diff review confirmed
  no guest programs, replay checks, or other test cases were removed; the
  only added runtime guards surround native differential assertions.
- No production or other-author files were edited during this task. No full
  build, install, commit, push, home sync, or publication was performed.

## Callback evidence rereview

Three test-only observer repairs requested by independent review:

- `callback-this.test.ts`: initialize `comparatorCalled` to false and set it only
  inside the comparator. Return it and require true alongside the existing
  `correctThis`, ordering, and source-mutation fixtures.
- `array-nested-reads.test.ts`: initialize `inspectCalled` to false and set it
  inside `inspect`. Require true for every comparator/reader combination,
  including `forEach`, whose return value alone cannot prove execution.
- `lang-01-validation.test.ts`: initialize `nestedReaderCalled` to false and
  set it inside the innermost `reduceRight` callback in the nested reader chain.
  Include true in the fixture checked against both initial execution and restored
  replay, including the `toSorted` case that discards the outer callback result.

No counters or comparator-order assumptions were introduced. All prior fixtures,
native capability guards, assertions, aliases, and replay checks remain. Only
these three test files and this plan changed during this repair;
`array-callback-mutation.test.ts` was rerun but not edited.

Validation sequence:

1. Observer RED: initialize and expose the three flags without setting them.
   Node 18.18.2 reports **29 failed / 485 passed** (2 comparator receiver cases,
   24 nested-reader combinations, 3 alias/replay cases), solely on false evidence.
2. Set flags inside their actual callbacks: **514/514 pass** on Node 18.18.2.
3. Temporary test-source omission controls, with production untouched:
   pass undefined instead of the receiver-test comparator; substitute undefined
   for the nested `forEach` call; remove `outer(left, 0, alias)` from the alias
   `toSorted` comparator. The old output fixtures still match, but the new flags
   detect the omissions: **5 failed / 509 passed on each runtime** (2 + 2 + 1).
   Controls used the same four-file command below with `--reporter=dot` and were
   removed with targeted patches before final validation. No control harness or
   deliberately failing test remains.
4. Final GREEN after removing controls: **514/514, four files, zero skipped** on
   Node 18.18.2 (1.30 s) and Node 22.22.2 (1.12 s), using the commands below.
   Per-file counts remain 130 / 202 / 41 / 141. Scoped Prettier, ESLint, and diff
   checks pass. Ready for Rawls's independent rereview.

## Reproduction commands

Run each runtime against exactly the same four files:

```sh
for version in 18.18.2 22.22.2; do
  /Users/kjopek/.nvm/versions/node/v${version}/bin/node node_modules/vitest/vitest.mjs run \
    packages/safe-js/src/interp/methods/array-callback-mutation.test.ts \
    packages/safe-js/src/interp/methods/array-nested-reads.test.ts \
    packages/safe-js/src/interp/methods/lang-01-validation.test.ts \
    packages/safe-js/src/interp/methods/callback-this.test.ts --reporter=default || exit
done
```

The RED command used Node 18.18.2 with the same files and `--reporter=dot`.

Scoped static checks:

```sh
node_modules/.bin/prettier --check \
  packages/safe-js/src/interp/methods/array-callback-mutation.test.ts \
  packages/safe-js/src/interp/methods/array-nested-reads.test.ts \
  packages/safe-js/src/interp/methods/lang-01-validation.test.ts \
  packages/safe-js/src/interp/methods/callback-this.test.ts \
  docs/plans/safe-js-node18-array-oracles.md
node_modules/.bin/eslint \
  packages/safe-js/src/interp/methods/array-callback-mutation.test.ts \
  packages/safe-js/src/interp/methods/array-nested-reads.test.ts \
  packages/safe-js/src/interp/methods/lang-01-validation.test.ts \
  packages/safe-js/src/interp/methods/callback-this.test.ts
git diff --check -- \
  packages/safe-js/src/interp/methods/array-callback-mutation.test.ts \
  packages/safe-js/src/interp/methods/array-nested-reads.test.ts \
  packages/safe-js/src/interp/methods/lang-01-validation.test.ts \
  packages/safe-js/src/interp/methods/callback-this.test.ts
```

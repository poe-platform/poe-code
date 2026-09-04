# #564: Native collation work calibration

## Scope and policy

September 4, 2026; base main `8c81239d9b08bb7654308cce468df6517c58b4e4`.
The issue requests operand-size calibration, not repair of a step-limit bypass.
Charge one logical work unit per UTF-16 code unit of the receiver plus the
converted comparison string. Admit the charge after existing comparison
conversion/string admission, locale canonicalization and option projection,
immediately before native `localeCompare`. Native option-value validation remains
in the native call; this does not introduce a separate Intl validator.

Only the string implementation, existing locale tests, Budget implementation and
directly relevant existing budget tests are owned, along with this plan. No
README, configurable-limit, scanner, cancellation, host-callback, isolation,
build, Git-delivery or broad-gate changes.

## Design

Extend the existing shared `visitNode` counter with optional units, default one.
Units must be non-negative safe integers; reject invalid units before mutation,
including while checks are suspended. Zero is a no-op. Bulk work is charged in
constant time, retains the full attempted charge on failure and uses the same
fatal budget error path. No caller writes `stepsUsed`.

Eligible units advance the existing 1024-unit deadline sampling window. A bulk
crossing samples once and retains the remainder, without looping per unit or
claiming elapsed-time measurement. Existing suspension skips deadline sampling;
all-check suspension still counts work. Deadline errors retain priority over
step errors at a crossed sample. Reset restores the counter and sampling window.
Ordinary no-argument AST callers continue to charge one unit.

## TDD and validation

1. RED: small varying operands, UTF-16 supplementary characters and converted
   comparisons; direct/extracted/bound paths; exact versus insufficient budgets;
   no native call on rejection; fatal error identity and precharge validation.
2. RED: bulk/default/zero/invalid units, retained failed charges, deadline
   remainder/priority, both suspension modes and reset.
3. GREEN: minimal shared-counter and string admission implementation, focused
   locale/budget tests, package-configured no-emit typing plus explicit owned
   test roots. Tests run uncached with Git-local environment variables removed
   only in the test child, using the supplied Node 22/npm 11 toolchain and TMPDIR.

## Evidence and limits

Prior read-only public-source probes found six AST steps for direct comparisons
at operand lengths 1, 16 and 256, with no proportional charge. A five-step cap
already rejected before native invocation. This change intentionally changes
work accounting, not native comparison values. There are no timing/RSS claims,
hard CPU-preemption guarantees or assertions that `maxSteps` was bypassed.

## Completed validation

Root advanced to `a6092b16a2fdc8da7006614d154831f48de0cb34` during this work,
changing upstream runner/workflow files, not the SafeJS target preimages.
No root runner/workflow validation is claimed here.

- Initial RED, unchanged production: 19 failed, 84 passed in the two owned test
  files. Failures showed ignored bulk units, absent validation/sampling and
  uncharged comparison operands.
- Independent admission RED: 1 failed, 62 skipped. With four required operand
  units and a three-step cap, the native spy observed one invocation instead of
  zero. Skips are not passes. This is the policy-specific failing admission test.
- Initial GREEN: 104 passed in the two owned test files.
- Final focused GREEN: 213 passed in eight budget/locale test files, including
  a direct native-admission deadline regression. Counts overlap and are not
  additive. Native values, empty/supplementary/numeric-coerced operands,
  direct/extracted/bound paths, exact-limit success, insufficient-budget native
  exclusion and fatal error object identity are covered.
- TypeScript: zero diagnostics using the parsed SafeJS package configuration,
  all 139 configured source roots plus the two explicit owned test roots,
  `noEmit: true`, `incremental: false`. Other package test files were executed,
  not all independently typechecked. No build was invoked.
- Prettier checks passed for all five owned files; scoped `git diff --check`
  passed. Root broad gates and guarded ESLint remain root integration work.

The final test command, from the repository root with the supplied Node/npm
toolchain on PATH, supplied TMPDIR, `NO_COLOR` unset and `TSX_DISABLE_CACHE=1`:

```bash
(
  while IFS= read -r variable; do unset "$variable"; done < <(git rev-parse --local-env-vars)
  node node_modules/vitest/vitest.mjs run \
    packages/safe-js/src/interp/budget.test.ts \
    packages/safe-js/src/interp/budget.compile-guard.test.ts \
    packages/safe-js/src/interp/data-budget.test.ts \
    packages/safe-js/src/interp/measure-record-budget.test.ts \
    packages/safe-js/src/interp/methods/string-locale-compare.test.ts \
    packages/safe-js/src/interp/methods/string-localecompare-validation.test.ts \
    packages/safe-js/src/interp/methods/string-localecompare-observer-validation.test.ts \
    packages/safe-js/test/integration/budgets.test.ts \
    --no-cache --reporter=dot
)
```

Typing used the TypeScript compiler API: `readConfigFile` and
`parseJsonConfigFileContent` on `packages/safe-js/tsconfig.json`, with its actual
directory/config filename and the no-emit/nonincremental overrides. `createProgram`
received the union of parsed file names and the absolute paths of
`src/interp/budget.test.ts` and `src/interp/methods/string-locale-compare.test.ts`
under the package. Parsed-config errors plus `getPreEmitDiagnostics(program)`
were collected; no emit or config-file generation was performed.

## Frozen source/test identities

SHA-256 paths relative to the repository root:

- `packages/safe-js/src/interp/budget.ts`:
  `148ee6618dd34dae34a3c1460291ee24895da583d87b6d8695636b89b94c801e`
- `packages/safe-js/src/interp/budget.test.ts`:
  `715869a7a6f1d5a353b6ec2f38310aa945a57431b7139d3f1dc8e55ab39d8a15`
- `packages/safe-js/src/interp/methods/string.ts`:
  `d1c78156199d24d90b66db68c0e99016756acbcf70e6a810e1f98a4aaec85b80`
- `packages/safe-js/src/interp/methods/string-locale-compare.test.ts`:
  `adcceafef85ac0ca3735848a701bc39e20558f3c454b196d888a647076e3639f`

The fifth owned file is this plan. Source/tests are frozen for root integration;
no further edits, stage, commit, push, release, broad gates or builds were done.
The counter change calibrates admitted work only: it cannot interrupt native
collation once entered, and it does not repair other owned scanners or public
cancellation behavior.

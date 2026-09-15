# Complete conformance runner package checks

Source HEAD: `f314e261c96e444b8fc983117864462171db5bc4`, with the runner qualification working-tree changes. Runtime: Node `v22.23.2`, ICU `78.2` (2026-09-11 local date). No runtime source repair was made during these checks. Unrelated untracked exploratory tests were preserved.

## Runner qualification checks

- `npx vitest run packages/safe-js/test/conformance/execute.test.ts`: first red run 6 failed / 12 passed. Direct and chained unhandled rejections, duplicate completion, and SharedArrayBuffer/IsHTMLDDA requirements falsely passed; agent requirement was a generic harness error.
- `npx vitest run packages/safe-js/test/conformance/realm.test.ts`: adapter red run 2 failed / 13 passed. Buffer detachment helper was absent; GC helper was undefined.
- `npx vitest run packages/safe-js/test/conformance/result.test.ts`: diagnostic red run 1 failed / 13 passed. Actual error phase/type/message and budget information were absent.
- Additional raw/module regression: execution suite 1 failed / 23 passed before the guard repair. `flags: [raw, module]` with body `0` incorrectly passed as a script. Neighboring raw-only test remains passing.
- Final execution/realm/result/metadata suite: 72 passed in 4 files, 3.28 seconds; test execution 1.32 seconds.
- Independent complete runner suite: `npx vitest run packages/safe-js/test/conformance`, 120 passed in 8 files, exit 0, 5.45 seconds; test execution 2.48 seconds.
- After the separately reproduced hard-timeout repair, independent final frozen complete runner suite: the same command, **140 passed in 10 files**, exit **0**, **5.83 seconds**, test execution **2.24 seconds**, started **2026-09-11 23:36:53 CDT (2026-09-12 04:36:53 UTC)**. Includes 12 supervisor tests and 7 worker tests. An intermediate run confirmed the reporting owner's TDD red for invalid timeout values and missing start acknowledgements (5 failed / 135 passed); those checks pass in the final frozen run.
- After the separately reproduced dynamic-import admission repair, the final v3 runner suite passed **145 tests in 10 files**, exit **0**, **7.60 seconds**, at **2026-09-12 01:28:56 CDT (06:28:56 UTC)**. The four-feature gate had first produced 5 failed / 25 passed; the repaired focused execution suite passed 30/30. Exact commands and pinned counterexample are in [the dynamic-import receipt](dynamic-import-independent-reproduction.md). Final v3 source hash: `b51f268c45c0643879c5c46eb088618a8db0415020c65e2e32ae47d8b928c9cc`, at the source HEAD and Node/ICU recorded above.
- `npx tsc --noEmit -p packages/safe-js/tsconfig.json`: exit 0, repeated after the v3 repair (8.71 seconds). Focused execution-file ESLint also passed after that repair.
- `npx eslint packages/safe-js/test/conformance/{execute,realm,result,metadata}{,.test}.ts`: exit 0, no diagnostics.
- Directory-wide ESLint: exit 0, one unused `_files` warning in `command.test.ts`; owner subsequently renamed it to `ignoredFiles`.

## Maintained package unit route

Command: `npm run test:unit --workspace=@poe-code/safe-js`.

The native `pretest:unit` script ran NumberFormat data generation and `typecheck:fs`. Generation reported 766 NumberFormat locales, 5,153,552 source bytes, and 224 plural locales. All four filesystem type contract combinations passed (NodeNext/Bundler × Node-only/DOM), 25 contracts each.

Final unit-process result: **exit 1**. **1,314 files: 1,310 passed, 2 failed, 2 skipped. 29,103 tests: 29,049 passed, 7 failed, 47 skipped.** Vitest started at **2026-09-11 23:16:17 CDT (2026-09-12 04:16:17 UTC)** and reported **1,810.25 seconds** elapsed (30 minutes 10.25 seconds), including 1,044.41 seconds of test execution, 624.12 seconds of imports, 26.24 seconds of transforms and 16.13 seconds of setup. This is a completed failing package receipt, not a passing gate. All seven failures are the two untouched exploratory files described below; no other failure or timeout appeared.

[Retained stdout tail](package-checks.stdout-tail.log) includes the final complete seven-failure diagnostics and authoritative terminal summary. Capture began after the earliest suites, so it is explicitly a partial log rather than a claimed complete stdout archive. No check was rerun solely to obtain a log.

The 47 skips remain nonpasses: 33 filesystem profile cases, one parser fuzz case, two native Math.f16round controls, seven structured-clone native Temporal cases, and four native Temporal.Instant cases. No unavailable profile was enabled or counted as passing.

This maintained route began before the hard-timeout worker and supervisor files were added. Existing execution tests were loaded later and include the new mode-selection regression, but new test files were absent from initial discovery. The separate final 145-test v3 runner result above is the authoritative post-repair runner check. The maintained package command was not rerun after the hard-isolation and dynamic-import changes; its seven failures remain a failed broad package receipt, and the later focused successes do not turn it into a passing package gate.

Validated failures:

- `src/interp/globals/iso-month-name-completeness.test.ts`: 6 failures / 12 passes. Long standalone ISO month output loses the month for en-US, pl-PL and ru-RU; both single values and ranges fail. Short/narrow/numeric/2-digit controls pass. The native Node/ICU control below also returns `[]` for all three long widths, so this is evidence of a host/ICU-backed limitation, not proof of an independent interpreter defect. Native behavior is a control, not the specification.
- `src/interp/promise-import-properties.test.ts`: 1 failure / 1 pass. A user-defined symbol property's value `42` is missing after `deepCopyToSandbox(Promise.resolve(1))`; a neighboring own string property descriptor is preserved. This concerns the host import contract. No symbol-copy runtime repair was attempted as part of runner qualification.

Both files were untracked before this work and remain untouched.

Native ICU control:

```js
for (const locale of ['en-US', 'pl-PL', 'ru-RU']) {
  console.log(new Intl.DateTimeFormat(locale, {
    calendar: 'iso8601', month: 'long', timeZone: 'UTC'
  }).formatToParts(Date.UTC(2000, 1, 29)));
}
```

Actual output: `[]`, `[]`, `[]`. Changing only `month` to `short` returns the month parts `Feb`, `lut`, and `февр.`.

## Independent reporting review

The review found and the reporting owner repaired three provenance gaps before the full-corpus freeze: mismatched header runtime/source/configuration fields were not checked; loaded workspace `dist` content was omitted from source provenance; binary bytes were decoded as UTF-8 before hashing. Current code checks header and summary provenance, hashes workspace source and distribution files, and hashes raw bytes for binary assets. Aggregation checks disjoint file coverage, all manifest variant modes, source hashes, and recomputed counts; metadata and execution errors remain explicit nonpasses. Fixture-only selections cannot return runner success.

No local commit, remote-main delivery, or release receipt is claimed by this check document.

## Read-only formatting and hook observation

During the frozen baseline, `npx prettier --check packages/safe-js/test/conformance` exited 1 with style warnings for all 21 files, including untouched metadata files. The neighboring control `git show HEAD:packages/safe-js/test/conformance/execute.ts | npx prettier --check --stdin-filepath packages/safe-js/test/conformance/execute.ts` also exited 1. This is a recorded formatting observation, not a passing formatting claim or a changed required gate. The maintained ESLint checks passed. No formatter write was run.

Actual Git hooks were inspected before a possible later local commit. `.git/config` sets `core.hooksPath=.husky/_`; its pre-commit shim exits without action because `.husky/pre-commit` is absent. The only project hook is `.husky/commit-msg`, which rejects co-author trailers and does not modify source. The resolved Husky initialization file `/Users/kjopek/.config/husky/init.sh` does not exist, and `HUSKY` is unset. No automatic formatter, test runner or build step is configured by these commit hooks, so no hook-induced change to frozen tested source is expected. Hooks must still run normally during any later authorized commit.

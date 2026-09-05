# Issue 646: join render step admission

## Authority and scope

- On September 5, 2026, `gh issue view 646 --json number,title,author,body,url`
  verified author `kamilio` in `poe-platform/poe-code` and the report of uncharged
  per-format-field loops in `join`'s `emit`.
- Baseline HEAD: `a4a53ff99`; preserve its existing fixes and all other workers'
  changes. No commit, push, branch, upstream merge, or README edits.
- Owned paths: `packages/safe-bash/src/commands/table-text/join.ts`,
  `packages/safe-bash/tests/commands/join-render-budget.test.ts`, and this plan.
  Root owns integration-inputs registration.

## Validation and implementation sequence

1. Run small in-memory tests against unchanged production code: 32-field output
   with maxSteps 32, a narrow positive control, and 128-field cancellation with
   falsey reasons scheduled through setImmediate. Record actual RED evidence.
2. Only after proving the defect, add existing Budget.step admission before
   field selection and parts construction. Reuse its cancellation checks and
   every-128-step cooperative yield; do not introduce another scheduler or cap.
3. Validate exact bytes, complete accepted prefixes, header/unpaired/auto/default
   rendering, output/field caps, backpressure, source byte ownership, and errors.
4. Run adjacent table-text tests without copies or large artifacts. Maintained
   lint is pending root coordination; do not run full-tree/frozen-tree guards,
   builds, typechecks, or mutate shared dist during concurrent source writes.
   Use the toolchain named in `/tmp/kamilio-toolchain.path` and
   `TSX_DISABLE_CACHE=1`. The supplied validation base is
   `/home/kjopek/kamilio-validation-569-575.RoFXyZ`; no new external artifacts
   are needed. Preserve evidence in this plan and tool output.

## Limits of the claim

This fixes cooperative operation accounting, not a CPU-time guarantee. Do not
reproduce the reported 1000-row workload or extrapolate execution time. Preserve
maxFields 65,536, maxSteps 2,000,000, argument/output/group caps, formatting, and
existing error behavior apart from newly admitted step exhaustion. Focused tests
are not a full gate or release qualification.

## Evidence

### Baseline and RED

- Actual baseline HEAD: `a4a53ff99898ea7cb1d5f435139b6bf2e56055c4`.
  Unmodified join.ts SHA-256:
  `83704c0da1bcd137fedf1e90e1d922af482bcfac290bc90f6b7ef3e36b6429b0`.
- Toolchain: Node 22.22.0 from the supplied toolchain directory, local tsx 4.22.4;
  every test invocation used `TSX_DISABLE_CACHE=1`.
- The first process-isolated `--test` invocation returned only a file-level
  failure summary. It is not the defect evidence. Direct node:test execution
  produced the individual assertions below, without a new test runner file.
- Initial 10 tests: 1 passed, 9 failed. Each of explicit/default/auto/header/
  unpaired rendering incorrectly returned exit 0 with maxSteps 32. Each
  128-field test completed without rejecting the scheduled falsey cancellation
  (`null`, `false`, `0`, and empty string). Narrow formatting passed.
- Expanded baseline run: 10 passed, 13 failed. Two additional failures were
  test-author expectation errors: diagnostics already include `EFBIG:` and
  `EPIPE:`. Corrected the tests to preserve existing diagnostic bytes; did not
  change production diagnostics. Applied the same prefix to step expectations.
- Corrected final RED: **23 tests, 12 passed, 11 failed, 0 cancelled**, exit 1,
  56.592552 ms reported by node:test. The 11 failures were the five render
  accounting cases, four scheduled cancellation cases, and two accepted-prefix
  step boundaries. All twelve compatibility controls passed before the fix.

RED command from repository root (before the production edit):

```sh
TSX_DISABLE_CACHE=1 /var/tmp/poe-code-kamilio-toolchain.GzqQj3/bin/node \
  --import tsx packages/safe-bash/tests/commands/join-render-budget.test.ts
```

### Minimal fix and GREEN

- Only production change: three existing-loop admission sites in `emit` call
  `await budget.step()` before selecting each explicit field, inspecting each
  default/auto input field, and constructing parts for each output field.
  Default/auto inspection includes the skipped join-key index. The existing
  per-row output charge is unchanged. An explicit N-field row now costs 2N
  renderer steps plus its existing output step and surrounding input/group work.
- These admissions reuse Budget's before/after abort checks and its existing
  every-128-step yield. No new caps, byte-length pricing, scheduling mechanism,
  error translation, or formatting changes.
- Immediate GREEN using the same command: **23 passed, 0 failed, 0 cancelled**,
  exit 0, 47.202404 ms reported by node:test. Timings describe these small tests
  only; they are not a performance comparison or time guarantee.
- Exact boundaries: two distinct-key, four-field rows need 26 steps; at 25 only
  the first complete row is accepted. A 2x2 same-key Cartesian join needs 43;
  at 25 only its first two complete rows are accepted.
- Controls cover unchanged output/field limits and defaults, acceptance of
  1,025 explicit fields, invalid UTF-8 bytes, NUL record separators, custom
  delimiters, replacement fields, finalized/reused Buffer producers, awaited
  sink backpressure without additional input reads, retained output bytes,
  falsey blocked-sink cancellation with cleanup, and exact EPIPE prefix/error.

Focused adjacent command:

```sh
TSX_DISABLE_CACHE=1 /var/tmp/poe-code-kamilio-toolchain.GzqQj3/bin/node \
  --import tsx --test --experimental-test-isolation=none \
  --test-concurrency=1 --test-reporter=spec \
  packages/safe-bash/tests/commands/join-render-budget.test.ts \
  packages/safe-bash/tests/commands/table-text/contracts.test.ts \
  packages/safe-bash/tests/commands/table-text/differential.test.ts \
  packages/safe-bash/tests/commands/table-text-stress/contracts.test.ts \
  packages/safe-bash/tests/commands/table-text-stress/corpus.test.ts
```

- **378 passed, 0 failed, 0 cancelled, 0 skipped, 0 TODO**, exit 0,
  772.263462 ms reported by node:test. Frozen GNU fixtures are existing recorded
  evidence, not a fresh native oracle run. This cohort includes in-memory Shell
  integration from the independent corpus; the separate integration.test.ts
  real-filesystem/large-input cases were not run.
- Product SHA-256:
  `48b064a95c99bfacdc56e706472ce38e41f5162da64b52979d8326e9d77371b2`.
- Test SHA-256:
  `2bb5569e40c81b1ec4a06060488b362038844e93b5acdcaff0b1ec556f03e150`.
- Owned product diff whitespace check passed. No other workers' files were
  edited, no shared dist was written, and no commits/pushes/branches were made.

### Pending root validation

Before the follow-up coordination instruction, an ad hoc ESLint `lintText`
check of the two owned TypeScript files, with manually supplied applicable
rules, returned zero errors/warnings. This was **not a maintained owned route**
and is not accepted as guarded lint evidence. No further lint bypasses will be
run. Maintained lint remains **pending**, as do root's exact integration-inputs
registration and any final frozen-tree build/typecheck/full gates. No full-gate,
delivery, or release claim is made.

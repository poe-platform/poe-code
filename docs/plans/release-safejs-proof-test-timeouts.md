# Release repair: bounded SafeJS proof-test phases

## Validated failure

The September 8, 2026 release run `34264322217`, unit job `102192464881`,
passed its shared unit phase but failed SafeJS timing checks. Its final log
confirms eight 5000 ms timeouts in `input-error-projection.test.ts`, plus timing
failures in four other SafeJS files. Each proof test performed both suspended
reconciliation and completed replay in separate fresh child processes under
one test deadline. Routine diagnostics included approximately one-megabyte
serialized observations; printing failed observations made the run crawl.
Normal cancellation did not finish promptly, so the already-failing run was
force-canceled. Its logs remain in
`/tmp/kamilio-release-runaway-unit-final.log`.

The unchanged proof file passed on the host with CI's Node 22.23.2. An offline,
read-only container using that same Node version and a 0.5-CPU quota reproduced
all eight proof timeouts: three passed, eight failed, 49.20 seconds. This is an
explicit contention reproduction, not a claim about the runner's exact CPU
allocation. The log is
`/tmp/kamilio-release-input-projection-halfcpu-red.log`.

## Repair

- Keep suspended reconciliation and completed replay as separate test phases.
  Each still uses a fresh child process, all existing provenance/replay/error
  identity assertions, the original child deadlines, and the default test
  deadline. No timeout increase, skipped test, or runtime behavior change.
- The replay phase requires the completed snapshot produced after its
  corresponding suspended-phase assertions; missing evidence fails rather than
  being skipped or synthesized.
- Serialized snapshot immutability uses native `Buffer.equals` for exact byte
  equality instead of a generic deep comparison of every indexed byte. Splitting
  the phases alone still left one 5000 ms timeout under the same 0.5-CPU quota;
  retain that intermediate result rather than calling it a passing repair.
- Normal test output reports observation status and context, not serialized
  graphs. Explicit `SAFEJS_O12_API=source` or `SAFEJS_O12_API=built` retains the
  complete typed diagnostic records for intentional evidence capture.
- The beyond-pipe-buffer test still transfers and verifies its full one-megabyte
  observation. Reducing routine logging does not reduce the transport regression.

## Delivery gates

Repeat the identical CPU-constrained reproduction with all 19 test phases,
rerun all five files implicated by the actual CI job, and run maintained lint.
Push this focused repair independently of the still-pending SafeBash feature
commits. Verify remote main, then monitor the new complete release validation
and actual npm publication. A local pass or successful push is not a release.

## Local gate results

- Identical offline 0.5-CPU reproduction: **19/19 passed**, 58.09 seconds,
  `/tmp/kamilio-release-input-projection-halfcpu-final.log`.
- All five files that failed in CI: **50/50 passed**, 30.21 seconds,
  `/tmp/kamilio-release-failed-files-final.log`.
- Routine diagnostic capture: 19 records, maximum 291 bytes per record, no typed
  graph payloads. Explicit source-mode capture still emits complete V8 records;
  the focused transport case verifies exactly 1,048,576 padding bytes. Its 18
  filtered cases are not counted as passes.
- Maintained repository lint, including ESLint, types and workflow lint: exit 0,
  `/tmp/kamilio-release-proof-repair-lint.log`.

No production file, workflow gate, snapshot oracle, adversarial budget or timeout
value changes. The two proof phases retain every original assertion.

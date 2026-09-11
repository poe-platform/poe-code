# Issue #576: text-program file writes share Shell output admission

## Validated baseline

Baseline: `be2436635736abda76b9f3543622feb1a01d7065`, September 4, 2026.
Use small memory-only witnesses. The historical 640 MB file and runtime figures
have not been reproduced and are not acceptance evidence.

- Actual public Shell/standard commands with `maxOutputBytes: 8` reject ordinary
  redirected awk stdout after eight admitted bytes. Named awk output instead
  writes twelve bytes and exits zero. Sed `w` and `s///w` do the same.
- With a sixteen-byte Shell cap and an eight-byte text-buffer cap, four awk
  prints write thirty-two bytes through named output. Repeated `close()` and
  overwrite cycles also write thirty-two cumulative bytes even though the final
  file occupies only eight. Append preserves the existing seed before growth.
- Nested `sh -c` named output and two `context.invoke` named-file writes bypass
  the same enclosing budget; equivalent stdout uses the shared counter.
- Host filesystem quotas stop growth past their stored-byte ceiling, but permit
  repeated overwrites whose final occupancy fits. Storage quota is not cumulative
  output accounting. Existing documentation recommends that independent defense.

The current Shell already binds its cumulative output ledger to command contexts
through `registerCleanup`. `openFileOutput` uses that binding for redirection,
tee and curl. Direct awk/sed `writeFile` and `appendFile` calls bypass it.

## Selected policy

Reuse the existing execution-wide `maxOutputBytes` ledger. Do not add another
public cap, a standalone-command default or a blanket filesystem wrapper. Direct
hosts without the Shell binding remain responsible for their own limits, as
already documented.

An internal direct-write helper must admit assembled bytes exactly once before
calling the existing host write. Keep whole rejected-write admission, zero-byte
creation/truncation, original flags, complete-write visibility, evaluation/error
ordering and `close()` reopening behavior. Do not convert these writes to
persistent streams or charge Shell's own internal rewrite traffic again.

Reservations survive host-write failure, matching existing sink accounting.
Cancellation must preserve its reason and existing settlement of admitted host
write promises. The interruptible Shell sink must not lose the actual pending
filesystem operation. Do not retain one cleanup callback per completed write.
No rollback or universal host preemption is promised.

## Ownership and verification

- Awk owner: runtime integration and a new focused command test file.
- Sed owner: write/substitution integration, plus in-place writes if independently
  validated, and a new focused command test file.
- Shared owner: internal helper, focused contract tests, exact literal test
  registration, and cancellation/settlement controls.
- Root: plan and filesystem-output contract, independent public integration,
  normal build, current-consumer checks, maintained lint, precise Git delivery
  and release monitoring.

TDD precedes each implementation. Cover exact/over limits, stdout/file sharing,
multiple destinations, nested invocation, failed-write charging, zero bytes,
overwrite/append/reopen, cancellation identity and admitted-work settlement.
Validate compatibility with existing text-program and filesystem-output tests.
Keep user-staged text/helper files and unrelated held evidence untouched.

## Delivery

Validation, implementation and local gates are complete in local commit
`35679576d17e019989dde12b985d42a6ac2b63c5`. Remote delivery and publication are
not established by that local commit. #596 is already delivered and closed; its release workflows run
independently while this issue progresses. Close #576 only after verified
remote-main delivery, before publication, and monitor its release separately.

## TDD checkpoints

- Awk command baseline: 17 tests, 11 passed / six failed. The failures are
  missing cumulative output-limit rejection for overwrite, append, shared
  stdout/files, multiple destinations, close/reopen and nested execution.
- Shared direct-write helper baseline: 16 passed / seven failed. A naive
  interruptible-budget wrapper then passed 15 and failed eight cancellation
  settlement cases. The corrected helper passes 23/23, joining the actual host
  promise without retaining cleanup registrations or changing the runtime ledger.
- Existing filesystem-output contract updated with an explicitly pending
  direct-write extension; the specification checker passes with zero warnings.

- Sed public baseline with an eight-byte Shell cap and 64-byte text cap: `w` and
  `s///w` each wrote 192 bytes; in-place mode replaced two 64-byte files. Ordinary
  stdout rejected. A 128-byte filesystem quota stopped the third 64-byte append,
  so no quota bypass is claimed. Initial isolated tests: nine passed / six
  failed; integrated expanded tests: 19/19 passed, related cohort 100/100 passed.
  The integration includes assembled in-place replacements and zero-byte output
  preparation, preserving existing host calls. Backup `copyFile` remains a
  separate operation, uncharged and before replacement as in the baseline.

- Awk final new tests: 18/18; combined text-program cohort: 183/183. A draft
  cancellation fixture incorrectly required the outer Shell promise to await
  opaque host work. An unchanged-shell control disproved that assumption; the
  corrected test observes the underlying command's admitted-write lifetime and
  preserves the existing Shell cancellation boundary. No Shell behavior was
  changed to satisfy the invalid assumption.
- Independent helper and integration reviews found no actionable defects.
  Concurrent actual-Shell probes admitted exactly two one-byte host calls at
  limit two and three at limit three. Literal discovery controls passed 2/2;
  all three new tests are registered. Combined new tests passed 60/60.
- Root's integrated focused run passed 380/380 with no skips or cancellations
  (`/tmp/poe-576-focused.log`), covering direct/streaming output contracts, command
  outputs, text programs, awk retention and allocation admission. The helper's
  independent root run also passed 23/23.

Normal root build passed (`/tmp/poe-576-build.log`). Current-consumer checks
passed: historical build-first, three source groups, 26 current groups and three
expected negatives (`/tmp/poe-576-consumers.log`, report directory
`/tmp/poe-576-consumers-report`). Rebuilt public-export checks passed 24/24 across
`virtual-bash` and `poe-code/safe-bash`: exact/over awk, sed `w`/`s///w`, in-place
replacement, shared execution allowance and fresh-exec reset. They preserve
completed prefixes/replacements and sed's eager empty-file preparation.

Maintained root `npm run lint` passed: 9,689 linted files, zero errors/warnings,
followed by root type checks and workflow lint (`/tmp/poe-576-lint.log`). Build
activity did not overlap guarded lint. Final source/test hashes match the
reviewed freezes. The three user-staged files remain at 33 insertions / three
deletions and are excluded from delivery.

Git delivery remains pending. None of these focused counts is a full root unit,
live-service or physical memory measurement claim.

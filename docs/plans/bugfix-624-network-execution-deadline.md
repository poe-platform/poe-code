# Issue 624: aggregate network deadline per execution

## Scope and validated issue

Date: September 6, 2026. The current issue body was fetched with
`gh issue view 624 --json title,body,url` before implementation. Source inspection
confirmed a fresh timer per URL and no aggregate network execution deadline.
The 32-URL default with 120-second per-URL limits permits about 64 minutes of
scheduled network lifetime only when the host raises the Shell wall-clock limit.
The default Shell wall clock remains 30 seconds. This is not an unbounded-default
or OOM claim, and no long-lived live-network reproduction was needed.

Root owns Git, registry integration, builds, gates and delivery. The original six
worker paths were frozen for issue 647 and restored with identical SHA-256 hashes.
The resumed assignment permits only three runtime additions: a frozen empty
`Budget.executionScope` token and its publication in the two real command-context
constructions. No `network/shared.ts`, yield helper, README or root registry was
edited by this worker. Root reports registering both new test paths.

## Implementation

- Add host `NetworkLimits.maxTotalTimeMs`: default 120,000 ms, Worker profile
  10,000 ms, validated as a positive safe integer by existing limit validation.
- Add optional public `CommandContext.executionScope?: object`, a borrowed opaque
  identity rather than a mutable budget object.
- Keep one monotonic start value in a per-command-factory `WeakMap`, initialized
  after argument validation on first network command admission. Omitted identity
  means a per-invocation fallback, not a per-URL reset.
- Share across URLs, retries, redirects, sequential commands, nested dispatch and
  parallel pipelines; separate each execution and each command factory.
- Clamp active timers to the remaining per-URL and aggregate allowances. Retain
  existing per-URL timer range validation even for huge aggregate limits.
- Tie timers to output/invocation cleanup, including headers, diagnostics and
  write-out. An expired scope admits no network; best-effort final reporting uses
  a zero-delay timer, so stalled reporting waits only for the next timer turn.
- Preserve response disposal, payload bytes, downstream backpressure,
  authorization policy, diagnostics and original-signal CPU checkpoints.
- Recheck original cancellation after cooperative cleanup, preserving caller and
  control reason identity over timeout or a competing cleanup rejection.

## Runtime wiring implemented

`packages/safe-bash/src/shell/runtime.ts` has exactly these additions:

1. `Budget`: `readonly executionScope = Object.freeze({});`
2. `Runtime.dispatchScoped`: `executionScope: this.budget.executionScope` on its
   `ShellCommandContext`.
3. `Runtime.shebangStage`: the same assignment on its reconstructed context,
   after spreading the incoming context.

`Shell.exec` already creates a fresh Budget. Child runtimes share it, and existing
context spreads preserve the identity through forwarding. No new public invoke
option, fresh child budget, cancellation-state change or diagnostic rewrite is
introduced. Actual-Shell tests cover sequential calls, `sh`, `env`, substitution,
parallel pipelines, concurrent execs and the frozen empty identity itself.

## TDD evidence

All new tests use in-memory filesystems, injected transports, mocked monotonic
clocks/timers and promise gates; no live networks, LLM calls or host fixtures.
`setImmediate` is used to expose a genuine late-cleanup scheduling boundary, not
as a slow sleep.

Initial worker evidence:

- Direct initial cohort: 16 tests, 8 RED / 8 GREEN before production changes.
- Output-wait additions: 32 tests, 3 RED / 29 GREEN before output lifecycle fixes.
- Shared CPU checkpoint: 34 tests, 1 RED / 33 GREEN before original-signal yield.
- Monotonic admission: 37 tests, 1 RED / 36 GREEN before admission rechecks.
- Pre-freeze direct result: 37/37 GREEN; Shell scope remained unimplemented.

Resume evidence uses the maintained `scripts/test-reporting.mjs` wrapper. The
sandboxed child-test runner reported only a file-level failure; an approved
outside-sandbox rerun produced concrete assertion results, not a gate bypass:

- `/tmp/issue-624-resume-shell-red.log`: 7 Shell tests, 6 RED / 1 GREEN before the
  three runtime additions. Missing scope, sequential reset and pipeline reset
  were reproduced without weakening expectations.
- Runtime wiring: 44/44 focused GREEN, comprising 37 direct and 7 actual Shell.
- Expired-report cancellation and falsey sink controls: 54/54 focused GREEN.
- Independent reviewer Euler identified two late-acquisition cleanup schedules:
  a cleanup rejection `0` could replace caller cancellation, and a quiet timeout
  could return 28 after cancellation arrived during the cleanup drain.
- `/tmp/issue-624-review-caller-red.log`: both schedules reproduced as fresh
  canonical tests, 49 direct tests, 2 RED / 47 GREEN before the cleanup fix.
- `/tmp/issue-624-resume-focused-green.log`: 56/56 focused GREEN after the fix,
  comprising 49 direct and 7 Shell tests, zero skipped or cancelled cases.

Focused command, from the repository root:

```sh
node packages/safe-bash/scripts/test-reporting.mjs --import tsx --test-concurrency=1 packages/safe-bash/tests/commands/network/aggregate-deadline.test.ts packages/safe-bash/tests/shell/network-execution-deadline.test.ts
```

Adjacent selection uses the same wrapper and these exact paths:

- `packages/safe-bash/tests/commands/network/zero-caps.test.ts`
- `packages/safe-bash/tests/commands/network/mounted-output.test.ts`
- `packages/safe-bash/tests/commands/network/byte-ownership.test.ts`
- `packages/safe-bash/tests/commands/network/exports.test.ts`
- `packages/safe-bash/tests/contracts/diagnostic-escaping.test.ts`
- `packages/safe-bash/tests/commands/diagnostic-display.test.ts`
- `packages/safe-bash/tests/shell/invocation-cleanup.test.ts`
- `packages/safe-bash/tests/shell/invocation-cleanup-setup.test.ts`
- `packages/safe-bash/tests/shell/cancellation-stage1-20260827/repair-v1/cancellation-repair.test.ts`
- `packages/safe-bash/tests/shell/cancellation-stage2-author-20260827/runtime-v1/runtime.test.ts`

The final adjacent rerun passed 298/298, with zero skipped or cancelled cases:
`/tmp/issue-624-resume-adjacent-green.log`. Euler independently replayed both
caller-priority failures against the fixed curl SHA-256
`5d338c71d383d6620ebcad45628822538d0c5b368a194f0ce06bc69bee15e7cc`:
both preserved the exact caller reason, remained pending through late acquisition
and disposed once. The independent bounded review also confirmed safe huge-limit
timer clamping and frozen/shared/fresh runtime identities; no outstanding
validated blocker was reported. These are focused source checks, not build,
typecheck, packed-consumer, full-gate, remote-main or release evidence.

## Full-gate failures and maintained-current fixture repair

Root's first full Bash unit run, session 29175, terminated with exit 1:
21,304 passed, 12 failed and 63 skipped; the separate runner cohort passed 279.
These failures are retained as initial gate evidence, not relabeled as passes:

- Two fixture failures: both tests in
  `tests/commands/network-zero-caps-review/holdout.test.ts` stopped at
  `runtime.mjs:15`, where exact default-object equality used the historical
  eight-field contract without `maxTotalTimeMs`.
- Ten genuine output-lifecycle regressions: eight cases in
  `tests/integration/owned-output-production-rebase/author/network.test.ts`
  emitted extra curl-23 diagnostics on stdout closure; the required-header case
  in `tests/plugins/html-to-markdown-public-author/lifecycle.test.ts` and the
  first-read/required-destination case in `tests/shell/remote-close.test.ts`
  observed unexpectedly aborted transport signals. Euler owns those production repairs and
  associated deadline tests separately. This fixture repair does not fix or
  certify those ten cases.

After the run terminated, root authorized exactly five maintained fixture files
and this plan, with no production changes. `holdout.test.ts` now declares the
explicit current nine-field default object, including `maxTotalTimeMs: 120000`;
no expected values are read from production exports. `runSuite` accepts optional
`expectedDefaults`, using it for strict whole-object equality and constructor
enumeration. `runMutations` forwards it. Both declaration files describe the new
option. Omission retains the historical profile for legacy capture entrypoints.
All seven mutation variants and their direct/Shell rejection assertions remain.

TDD and focused verification:

- `/tmp/issue-624-current-fixture-red.log`: both holdout tests freshly failed
  exact equality before the runners accepted the current expectation.
- `/tmp/issue-624-current-fixture-green.log`: 58/58 node:test cases passed,
  comprising the two maintained holdout wrappers and 56 deadline tests; zero
  failures, skips or cancellations.
- The holdout matrix executed 326 checks: 220 constructor validations and 106
  direct/Shell executions. Of the constructor checks, 24 exercise
  `maxTotalTimeMs` across both factories: positive one/MAX_SAFE acceptance and
  zero, negative-zero and invalid-value rejection. This is not 326 node:test
  cases and does not change historical 604-check archive results.
- All 7/7 mutation controls were detected across 14 deliberately failing
  direct/Shell executions; these expected negative executions are not failed
  node:test cases.

Maintained command, from the repository root:

```sh
node packages/safe-bash/scripts/test-reporting.mjs --import tsx --test-concurrency=1 packages/safe-bash/tests/commands/network-zero-caps-review/holdout.test.ts packages/safe-bash/tests/commands/network/aggregate-deadline.test.ts packages/safe-bash/tests/shell/network-execution-deadline.test.ts
```

The historical seal itself remains SHA-256
`9a686c3acb7a66dbc232a3b368985697d6a12c4e98803b972f8e427259deec2d`.
All 26 sealed members outside the five maintained files were checked against
their original sizes and hashes and remain byte-identical, including captures,
`profile.mjs`, `FROZEN.md`, README and `current-checks.json`. The frozen profile
retains SHA-256
`8bc90dfe73daebb944f406c5a53f506879c3ff0db5e05b5c7fa919c6a860d67c`.
Old metadata was not regenerated to pretend it authenticates updated helpers.
No builds, lint, Git operations or production edits were performed for this
fixture repair. Focused green results do not replace a subsequent root full gate.

## Remaining integration ownership

Root retains registry validation, maintained build/typecheck/lint/full-gate
selection, independent review disposition, Git and delivery. The worker does not
close the issue or claim delivery. Contracts are documented in
`packages/safe-bash/src/contracts/command.md` and
`packages/safe-bash/src/contracts/network-deadline.md`; no README was changed.

## Output-lifecycle repair after the initial full gate

Root assigned Euler only the deadline helper, curl and owned deadline tests,
then authorized this appended evidence. The five repaired historical fixture
files and all three regression wrapper files remained untouched by this repair.

Two concrete helper defects explain the ten runtime failures:

- Normal operation cleanup called `lifetime.abort()`. Closing a successfully
  completed transport therefore aborted its signal even when required file or
  header destinations remained independent of stdout closure. The two wrapper
  assertions require that transport signal to remain live at public settlement;
  these failures detected an unexpected abort, not an unreleased transport.
- A write-out operation created after stdout consumer closure is already aborted
  with EPIPE. Registering its deadline cleanup threw before `publish` entered its
  EPIPE handler, converting ordinary downstream closure into curl 23 and extra
  stderr. This explains all eight zero-cap/stdout-close cases.

The production repair is limited to `network/aggregate.ts`: return the already
aborted output operation without registering a timer, and clear the timer on
normal cleanup without aborting the completed operation. Active operations still
receive the same deadline abort. `curl.ts` is byte-unchanged, including the
original-caller cancellation recheck after late-acquisition cleanup.

TDD and bounded verification on September 6, 2026:

- Two fresh Memory/mock controls failed before the production edit: normal
  completion produced `signal.aborted === true` instead of false; preclosed
  stdout write-out after required file output returned 23 instead of 141.
- The first focused rerun was 58/60: both new controls passed, but two owned
  deadline assertions had depended on the erroneous normal-cleanup abort.
  Write-out/final diagnostics occur after response disposal, unlike dump-header
  output. The tests now check that disposal has already occurred and the
  transport signal remains live for the first two phases, while active
  dump-header transport is aborted on timeout. All three retain the original
  pending-sink settlement bound and exit-28 assertions, and additionally require
  exactly one disposal. No regression wrapper expectation was changed.
- Final maintained focused run: 60/60 passed, zero skipped/cancelled/failed,
  comprising the previous 58 cases plus two new controls. Its holdout diagnostics
  still report 326 checks and all 7/7 mutations detected.
- The exact three unchanged regression wrapper files passed 60/60 with zero
  skipped/cancelled/failed, including all ten initial runtime regressions.
  The real required-destination probe reports one completed transport cleanup,
  one response disposal, no pending body reads, no residual child, and a live
  transport signal at public settlement. This run used the same final production
  helper bytes; only the owned deadline test assertions changed afterward.
- Runs used Node 22 from `/tmp/kamilio-toolchain.path`, `TSX_DISABLE_CACHE=1`,
  base `TMPDIR`, normal child isolation and the maintained reporter. The initial
  sandbox test-child failure was rerun with approved external isolation; it was
  not counted as a semantic RED or bypassed through isolation changes.

Final focused command is the three-file maintained command in the fixture
section above. Exact adjacent command, from repository root:

```sh
node packages/safe-bash/scripts/test-reporting.mjs --import tsx --test-concurrency=1 packages/safe-bash/tests/integration/owned-output-production-rebase/author/network.test.ts packages/safe-bash/tests/plugins/html-to-markdown-public-author/lifecycle.test.ts packages/safe-bash/tests/shell/remote-close.test.ts
```

Final SHA-256 evidence:

- `src/commands/network/aggregate.ts`: `d3280fb9c28b6eba5f4b2dc641d7ab02c6003cf4d786cd5d80ef2a59ae1b2e99`
- Unchanged `src/commands/network/curl.ts`: `5d338c71d383d6620ebcad45628822538d0c5b368a194f0ce06bc69bee15e7cc`
- `tests/commands/network/aggregate-deadline.test.ts`: `bb78ef1e85b9585e23896a85040869d5e2d24a2120b755640ac5bc20b4f23783`
- Unchanged `tests/integration/owned-output-production-rebase/author/network.test.ts`: `e8cdadd4d712d320fa6db60833f7fa9648246d6c13f450b00c199a033e4aa193`
- Unchanged `tests/plugins/html-to-markdown-public-author/lifecycle.test.ts`: `abc252166d7951f61b555d6452bc57b5dc775abd27cf3e2c55ee083332fb9793`
- Unchanged `tests/shell/remote-close.test.ts`: `98078db8184b107794223f855cac031161f21fe72772e026ce7908430d482432`

No Git, build, lint, broad tests, registry edits or shared dist writes were
performed. These focused results do not constitute full qualification; root
retains the freeze, maintained gates and delivery decisions.

### Root declaration inventory reconciliation

The repaired candidate's normal build passed, but public typecheck stopped
before compiling any consumer because the two maintained `.d.mts` support
declarations still had their previous hashes in the current standalone inventory.
Root reviewed their optional `expectedDefaults` signatures and updated only those
two declaration hashes and explanatory reasons in
`tests/plugins/qualified-current-release/inventory.json`. Classifications, input
membership, counts, frozen evidence and exact-hash enforcement remain unchanged.
The original failure is retained separately; this inventory correction is not a
typecheck pass until the maintained route succeeds.

The next attempt correctly rejected the changed inventory at its existing
outer hash boundary. Root updated that one literal owner hash in
`scripts/integration-inputs.mjs` to authenticate the reviewed two-entry change;
no guard, assertion, classification or input selection was relaxed. Both failed
attempts remain recorded, with zero consumer groups executed in each.

Public types, lint, shared unit tests and Python tests subsequently passed. The
Bash runner then detected its historical source7 digest comparison still included
the two explicitly updated current declaration records (278 passed, one failed).
Its test now verifies both exact current records before reconstructing their
historical values in the existing comparison clone. Both original historical
digest assertions and the thirteen-entry sealed cohort remain unchanged; actual
inventory data is not rewritten. The failed full command remains recorded.

The next full run passed all 279 Bash runner checks and 21,317 Bash tests, with
63 optional-profile skips. Its sole failure was committed-archive admission:
`HEAD` still contained the previous `scripts/integration-inputs.mjs`, whereas the
reviewed working-tree authority contained the new inventory pin. The verifier
correctly refused before any archive build steps. Root will commit the owned
candidate locally and validate that exact revision without weakening the
committed-input equality check; a local commit is not a push or release.

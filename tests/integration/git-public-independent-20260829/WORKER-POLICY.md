# Proposed exact RegexWorker role — NOT YET ADMITTED

## Source evidence

The accepted public79 SOURCE-COMMON-REGEX.md records these unchanged bindings:

| Source | SHA256 |
| --- | --- |
| regex-execution/client.ts | `5d086314898c38390753a07ef1c37001890ac2b47f3d0e05e221048b9db42ebc` |
| regex-execution/worker.ts | `a442bb67cda6aff313cf3909cbfb0d3d8c12ebc420437d5fd9d7bd51fc6c9da6` |
| regex-execution/protocol.ts | `3610a50b436e083b2633e08c841978999b5fa61759fcaea224aeec97230c8bc1` |
| regex-execution/matching.ts | `1d21b81ebbfe361405556aa59b58f6e2cf9f6d487e9518c5d77a90af36690737` |

The inspected client constructs a file-URL Worker with `execArgv: []` and
`resourceLimits` containing `maxOldGenerationSizeMb` and `stackSizeMb` from its
validated executor settings. Compiled code selects `./worker.js`; its source
branch instead selects the matching dist path. It does not inherit the parent's
loader flags. Retirement awaits `worker.terminate()` when exit was not already
observed. The worker imports its actual protocol/matching closure and services
requests; it is not an arbitrary-script facility.

The author's handoff reports compiled worker SHA256
`46479e6d87bd5d20371a2e523310b2275c74d32d15105fcc9678ec73410efe4f`.
This remains an author-reported value until the complete candidate tar and its
transitive emitted dependency closure are independently authenticated.

## Proposed admission, requiring concrete implementation and controls

- Permit only the canonical regular-file URL of the selected physical package's
  `dist/commands/regex-execution/worker.js`. Reject other URL schemes, eval/source
  text, symlink/outside-root entries and all unbound worker files.
- Validate exact own-data option keys, primitive types, empty dense execArgv and
  exact resource-limit keys/values for the selected workload. Do not use realm
  prototype identity; reject accessors, extra fields and holes. No injected
  workerData/env/SHARE_ENV/execArgv override. Actual numeric values must be
  extracted and bound before execution, not guessed here.
- Authenticate the complete worker dependency closure and inspect its imports
  before enabling this role. Parent load traces cannot prove worker-internal
  loads because the product deliberately clears execArgv. Choose and document a
  compatible concrete guard: unchanged closed dependency graph plus immutable
  file containment, or separately qualified worker-load instrumentation. Do not
  label source closure as a runtime import trace.
- Keep the existing no-network/no-private/no-native-exec boundaries. Merely
  adding `--allow-worker` is not a sufficient capability fence. Deny unrelated
  Worker construction and worker-created descendants; explicitly verify the
  implementation mechanism before admission, without changing product code.
- Run cohorts serially. Plan at most one active product RegexWorker, at most32
  cumulative; loader-thread reservations are separate. Author evidence expects
  four product workers in the maintained suite, but independent outcomes must
  be measured rather than capped to force that historical number.
- Record admission before construction, exact entry/options/hash and creation,
  errors, exit/termination, owner cleanup and final active count. A registration
  attempt alone does not prove retirement. Enrollment/logging failures must not
  leave an unowned live worker. Unknown closure or trace overflow stops work.

Pre-execution harmless controls must reject wrong entry/hash/options, a nonempty
execArgv, alternate URL/eval source and extra resource-limit keys; positive
cross-realm exact own-data values must be accepted. A late success record cannot
mask nonzero status or a remaining worker. No controls have run here.

## Four old rows preserved

| Original TAP row | Maintained test |
| --- | --- |
|69|definitions fallback resolves nested argv across families without a shell|
|70|plugin fallback resolves nested argv across families without a shell|
|75|aggregate forwards search limits without rewriting them|
|80|search defaultInput remains an explicit family override|

Rows69/70/75 captured Worker-permission diagnostics. Row80 captured a status
mismatch; the same cause there is source-route inference, not captured stderr.
The fixture SHA256 is
`d19dd492d498c3a7754b93cc9041615ab8011b4eacbbca3a64df8011cb8c46a2`.
Neither those failures nor the author's later83/83 are independent successes in
this preparation. A new candidate/profile replay must be recorded separately.

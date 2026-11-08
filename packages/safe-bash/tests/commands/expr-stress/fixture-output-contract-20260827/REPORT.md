# Two fixture expectations and one RED output contract

August 27, 2026. Delegated leaf; no redelegation. No product, shared source,
root export, native oracle, frozen expectation, or documentation-contract edits.
This is scoped evidence, not a full gate, public integration acceptance, expr
completion, native superiority, or 72-hour work claim.

## Commits and authenticated composition

- Accepted product source: `21220b465537bf45ffcfb36740956a69f43bf75e`.
- Test-only fixture commit: `be72c9c86c1a6cb00a0b14d86a7f3f8eb7b6c5e7`.
  Its only changed path is `tests/commands/expr/grammar.test.ts`.
- Evidence is a separate commit containing only this new directory. The final
  handoff records its commit ID; no self-referential commit hash is fabricated.
- `before-01` executes a selected immutable accepted-base Git archive. `after-01`
  executes the same archive with **only the grammar fixture from the committed
  test-only change** overlaid from Git, not the live working tree. This explicit
  two-commit composition is not a whole-commit archive gate. Archive inventories
  differ at exactly that one file; no product input is overlaid.
- Both captures include all accepted-base `src`, the expr test directory, the
  single imported author regex-audit helper, package/lock and TypeScript configs.
  They do not inventory or execute the repository's entire test tree.
- Runtime inputs/driver/assertions are byte-preserved from `d0fb3ef0`; its report
  is preserved from `1231700a`. Each original path, full commit and SHA256 is in
  `before-01/preserved-inputs.json` (and independently in `after-01`).
- Exact source, README, Budget, ByteIO, Shell and error-channel snapshots are
  inert `.data` files in `source-bindings`, with accepted-base Git blob/SHA256
  bindings. The author-policy report/seal are bound to `7fc76f39` separately.

## A: exactly two wording changes

The original invalid-case loop and argv list stay in place. For **only** `[]`
and `["--"]`, the old third assertion was:

```ts
assert.match(actual.stderr, /^expr: (syntax error|division by zero|non-integer argument)/u);
```

The new third assertion is exact equality to:

```text
expr: missing operand
Try 'expr --help' for more information.
```

Both lines terminate with LF; equivalently the exact string is
`"expr: missing operand\nTry 'expr --help' for more information.\n"`.
The original `assert.equal(actual.exitCode, 2)` and
`assert.equal(actual.stdout, "")` remain unchanged. Every other invalid argv
retains the exact original regex assertion; successful cases and help/version
assertions remain unchanged. No native helper or oracle assertion is changed.

Full original and executed bodies are retained as `grammar.before.ts.data` and
`grammar.executed.ts.data` in both capture directories. The exact patch is
`after-01/fixture.patch`. `assertion-audit.json` records all 73 generated test
names, argv calls and assertions before/after: 71 identical traces and exactly
two third-assertion deltas. That audit uses stubbed results and recording asserts
to inspect assertion structure; it is not presented as runtime acceptance.

| Cohort | Original/before | After | Meaning |
| --- | ---: | ---: | --- |
| Historical qualified legacy report | 239/241 | Preserved unchanged | Original report and raw output retained |
| New accepted-source legacy replay | 239/241 | 241/241 | Same eight test-file arguments, two authorized assertion changes |
| Grammar subset | 71/73 | 73/73 | Overlaps the 241; not an additional denominator |
| Accepted-source diagnostic regressions | Not rerun before | 71/71 | Separate existing file, unchanged assertions |
| Frozen independent runtime controls | 11/12 | No changed runtime expectation | `syntax-output-one` still RED |

All newly run test cohorts have zero skips, cancellations and TODOs. The legacy
command arguments are preserved verbatim in `legacy241-run.json`. Both original
historical runs are copied: the first 235/241 with four missing-prerequisite
failures, and the qualified 239/241 with two grammar failures. Neither original
result nor its prerequisite-repair report is rewritten. These canonical tests
retain their existing documented unsupported-case assertions; 241/241 is not
241 native-parity inputs and does not erase other known expr gaps.

## B: exact frozen runtime RED

`freeze/runtime-binding.json` in `d0fb3ef0` binds:

```json
{"id":"syntax-output-one","argv":["1","x"],"limits":{"maxOutputBytes":1},"expectedStatus":2,"expectedStderr":"expr: syntax error: unexpected argument 'x'\n","workers":0}
```

The exact constructor expression in the frozen driver is
`createExprCommand({limits:payload.input.limits})`. Thus this row supplies
`{ limits: { maxOutputBytes: 1 } }`, not a flat option, not Shell limits, and not
`maxEvaluationSteps`. All other expr settings use accepted-source defaults;
`regex` and `replace` are omitted. Earlier unbound sketches in `inputs.json`
remain preserved beside the authoritative API-corrected binding.

The frozen direct `execute` context uses `command: 'expr'`, args `["1","x"]`,
`cwd: '/'`, `env: {LC_ALL:'C'}`, a fresh nonaborted signal,
`stdinIsDefault: true`, a throwing stdin getter, a throwing FS proxy, a throwing
`invoke`, and synchronous cleanup registration. Both stdout and stderr sinks
copy accepted bytes and independently assert accumulated length **<=8192**.
They do **not** enforce a one-byte stderr limit. There is no Shell in this row;
the separate `literal-command-binding` control is the Shell/registry row.

The frozen evaluator first requires `activeBeforeSafetyCleanup === 0` and no
`workerStart` event, then requires `actual.status === input.expectedStatus`,
`stderr === input.expectedStderr`, and `stdout === ''`. These conditions, their
options, and their comparison operands were not changed. The original exported
driver was replayed unchanged against the built accepted-source archive.

| Field | Frozen expected | Actual |
| --- | --- | --- |
| Status | 2 | **3** |
| stdout | empty | empty, 0 bytes |
| stderr | `expr: syntax error: unexpected argument 'x'\n` | `expr: output bytes limit exceeded\n` |
| stderr length | 44 bytes | **34 bytes**, greater than the configured 1 |
| Promise rejection | Not the expected path | false; error is null |
| Worker starts | 0 | 0 |
| Active at settlement / before safety / after safety | Zero before safety required | 0 / 0 / 0 |
| Cleanup event | Driver records registration | `registerCleanup` |

The raw bytes/base64, invocation, assertions and exact result are preserved in
`before-01/runtime-frozen.json`. Result: **11/12, RED remains RED**. This capture
replays the twelve original controls sequentially in one process, unlike the
historical per-job outer-worker containment. The frozen driver's instrumentation
and cleanup are unchanged; cached imports explain empty import traces on later
rows. These receipts do not claim new outer-watchdog or universal worker proof.

## Output and error-channel behavior, not a universal cap

1. **Successful output.** `src/commands/expr/index.ts:24` checks help/version
   bytes; `src/commands/expr/index.ts:49` checks evaluated result length plus LF
   before final stdout allocation/write. `maxOutputBytes` is invocation-local.
   The separate `['1']` controls show limit1 -> status3/empty stdout/fallback,
   limit2 -> status0/`1\n`; `['']` at limit1 -> status1/`\n`.
2. **Syntax diagnostics containing untrusted argv.** In
   `src/commands/expr/syntax.ts:23`, quoted token encoding/escape expansion is
   charged to string allocation and work limits. In `syntax.ts:17`, `fail`
   checks `Buffer.byteLength(message) + 7` (literal `expr: ` plus LF) against
   `maxOutputBytes`, then charges work and throws status2 `ExprError`. The check
   applies to every parser `fail`, including fixed missing-operand text, not
   merely diagnostics containing a quoted token. For `["1","x"]`, the required
   44 bytes exceed 1, so `Budget.check` throws status3 before the syntax error is
   published. This is explicit implemented behavior, not silent truncation.
3. **Fixed refusal/error channel.** `src/commands/expr/internal.ts:53` makes limit
   failure an `ExprError(..., 3)`. `src/commands/expr/index.ts:58` catches it and
   awaits `writeBytes(stderr, encode('expr: ' + message + '\n'), signal)` without
   rechecking that message against the expr output quota. Thus the fixed
   34-byte refusal can explain a one-byte quota. Fixed evaluation errors also
   bypass the parser diagnostic gate: division by zero at limit1 still produces
   status2 and its 23-byte message. There is **no universal expr stderr cap**.
4. **ByteIO and host policy.** `src/contracts/io.ts:132` validates Uint8Array and
   awaits the signal-aware sink write; it has no intrinsic max-output counter.
   `collectBytes` has its own explicit maxBytes, unused by these direct sinks.
   Diagnostic sink rejection escapes the catch; cancellation is rethrown before
   writing. Existing unchanged diagnostic regressions exercise backpressure,
   sink-error identity and abort behavior. Separately, Shell's `Budget.sink` in
   `src/shell/runtime.ts:85` accounts bytes, and Shell wraps stdout **and** stderr
   in those budgeted sinks (`src/shell/shell.ts:115`). A host/Shell sink may reject
   a fallback; the expr refusal is not exempt from every outer policy.

`boundary-01` independently measures 44 bytes, then observes limit43 -> status3
fallback, limit44 -> status2/full syntax diagnostic. Those are separate controls,
not raised limits for the frozen RED. Preserve an exploratory harness mistake:
`before-01/runtime-observations.json` used guessed labels “boundary-below”/“exact”
for 41/42; both actually refused. In particular, the 42-byte “exact” label was
wrong. That original input/result is retained. The new measured 43/44 capture
corrects only that supplemental boundary claim, never the frozen expectation.

## Is the author's policy documented?

**Yes, in the sealed author evidence; not consistently in the module README.**
`tests/commands/expr-author/diagnostics-fix/REPORT.md:56`, committed in
`7fc76f3917a38c0cc39d46c02383c947fa3ac110`, explicitly says expanded quotation is
capped by maxStringBytes, complete parser diagnostics are checked against
maxOutputBytes before publication, and fixed status3 refusals may exceed the
configured cap. It explicitly disclaims an absolute all-stderr cap. The accepted
source's `diagnostics-regression.test.ts:54` also tests that policy, including the
ordinary diagnostic's measured exact/one-less boundary. This is more than an
inferred implementation intention or an undocumented reviewer excuse.

However, accepted-source `src/commands/expr/README.md:139` describes
maxOutputBytes as **final stdout allocation including LF**. At `README.md:168`
it says diagnostics are **fixed-size bounded messages outside the stdout byte
limit**, allowing a tiny stdout allowance to report failure. That is consistent
with fixed fallback messages but is incomplete/stale for the new token-bearing
parser diagnostics, and it does not disclose the parser's extra quota gate. The
broader statement about fixed-size diagnostics is no longer generally accurate.

**Finding:** an actual frozen runtime assertion failure plus a documentation /
contract inconsistency. The runtime agrees with the explicitly recorded author
policy and its regression tests; the stdout-only README reasonably supports the
frozen expectation's different interpretation. If that README exclusion is the
binding policy for all diagnostics, this is a runtime contract violation. If the
sealed author policy is adopted, the README and the old independent assumption
need separately authorized reconciliation. This leaf does not choose a new
normative policy, waive the failure, label the implementation universally buggy,
or promote author intent to a passing frozen gate. **Keep RED pending the owner's
policy decision.** No such reconciliation is made here.

## Integrity, cleanup and limits

- Source/config/test inventories and built output are checked before/after,
  including **new entries**, within the selected archive; dependency inventories
  are separately checked. Read-only node_modules and native-prerequisite symlink
  bindings are recorded explicitly, not counted as product filesystem behavior.
- The pinned native GNU9.7 Darwin executable is unchanged before/after with
  SHA256 `e8a4e2b58a33d2ad6bfa9eb8a4ed5f62775ab9ceac4b9421680c98973fd9109c`.
  Its original identity/version/linked-library receipt is preserved; no new
  library-signature verification or GNU/Linux equivalence is claimed. Unchanged
  legacy tests perform their own binary/version/locale prerequisite checks.
- The two main source builds and the boundary-only archive build pass. These
  are source/declaration builds, not global strict-consumer or test typechecks.
  No global test command, default evidence writer, native golden recapture,
  package dependency change or product edit runs in this assignment.
- All three owned archive directories, their generated dist and their symlink
  bindings are removed. Frozen runtime cleanup is awaited and its zero-active
  counters are retained. No claim is made about all workers in other processes.
  Unrelated concurrent edits, index entries and native scratch directories are
  not staged, changed or removed by this leaf.
- Captures write only explicit fresh output paths; existing receipts are never
  overwritten. `.ts.data`/`.data` snapshots are inert evidence, not canonical
  TypeScript input or test discovery exclusions. `SEAL.json` authenticates this
  evidence tree except itself; a verifier must compare the full entry set to
  detect appended entries, not merely hash the original listed files.

## Explicit reproduction

From the repository root, with the same authenticated prerequisites:

```sh
node tests/commands/expr-stress/fixture-output-contract-20260827/capture.mjs --capture before new-before
node tests/commands/expr-stress/fixture-output-contract-20260827/capture.mjs --capture after new-after be72c9c86c1a6cb00a0b14d86a7f3f8eb7b6c5e7
node tests/commands/expr-stress/fixture-output-contract-20260827/boundary-controls.mjs --capture new-boundary
```

The capture driver's zero exit means evidence collection/integrity completed,
**not** that all captured tests passed; inspect the recorded subprocess statuses
and frozen runtime `passed` values. The unchanged baseline has deliberate real
failures. No result here supersedes the original cohorts or certifies unrelated
live candidates.

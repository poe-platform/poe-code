# Expr emergency-output independent review — August 27, 2026

**FAIL / SOURCE CHANGE REQUIRED: 36/47 controls pass in each of two runs.**
The selected emergency case passes, but normal diagnostics bypass the normal
quota. This leaf changed no production source, package/config, global contract,
old fixture or old evidence. The blocker was reported immediately after source
inspection in `/tmp/expr-emergency-proof-20260827-issue.txt`, before freezing and
executing controls. No redelegation or broad suite execution occurred.

## Binding and freeze

- Immutable candidate: `7623599c995c42f62ec1cd9ad78ced2913970f66`, the inspected
  initial HEAD. Later unrelated HEAD changes do not enter this candidate.
- Selected Git archive: `src`, `package.json`, `package-lock.json`,
  `tsconfig.json`, `tsconfig.build.json`. SHA256:
  `6d6b7ca9a07b910b452f6d041e96460ba189b7de2d480531e8917ff804c5cc2e`.
- `FREEZE.json` records the complete selected Git tree, exact control file
  SHA256s, serialized input/expectation hash, dependency inventory and complete
  historical-evidence inventories. Selected live inputs were clean at freeze.
- Freeze completed at **20:12:37.715 UTC**; run01 executed **20:12:43.741–
  20:12:46.340 UTC**, run02 **20:13:05.354–20:13:08.626 UTC**. These are
  postcandidate independently authored controls frozen before execution, not
  preimplementation holdouts or a 72-hour claim.
- Host: **Node v22.22.2, Darwin arm64**. Each run builds the committed archive
  separately using the inventoried development TypeScript installation and
  `--skipLibCheck false`. Both source/declaration builds pass. Runtime imports
  the actual archived build's `dist/commands/expr/index.js`; no live source
  overlay, tsx runtime, native oracle, package installation or root-export
  acceptance claim is involved. The three Shell controls use that same build.

Critical source SHA256s (complete per-entry lists are in `archive-before.json`):

| Path | SHA256 |
| --- | --- |
| `src/commands/expr/index.ts` | `4fd60b3b2fec4126e42e492922004e90e870a08aa319d2f088c085255355841d` |
| `src/commands/expr/syntax.ts` | `4e8d05cc672be9f0786ebd74b09f9524028fd1d4f1491319cccd8a74d1ea3df0` |
| `src/commands/expr/evaluate.ts` | `04ca8f588ccaea97b3801fe30accfa6020636c5f72f156b0d158fa6474f525c9` |
| `src/commands/expr/internal.ts` | `07f203d8fc4e991e4d23cab87d67a23911f7960a2ed6d649fd843b0d7060e840` |
| `src/commands/expr/bre-worker.ts` | `f5c67e9c76b584337ae506b59449ecdcd945207b2269fdb4f79c5d1f7e81aff0` |
| `src/commands/regex-execution/client.ts` | `5d086314898c38390753a07ef1c37001890ac2b47f3d0e05e221048b9db42ebc` |
| `src/contracts/io.ts` | `ff792b401508a2ef768aa4f9dd9794e653e1e14f2163e57d137e9cb2b7427809` |

## Exact selected behavior and boundaries

`createExprCommand({limits:{maxOutputBytes:1}})` with argv `['1','x']`
returns status **3**, empty stdout and exactly one awaited stderr attempt:

```text
expr: output bytes limit exceeded
```

The final LF is included: exactly **34 bytes**, hex
`657870723a206f7574707574206279746573206c696d69742065786365656465640a`.
This emergency diagnostic is outside the normal budget: the test explicitly
accepts 34 bytes at cap1, never an absolute combined output cap.

The normal diagnostic is `expr: syntax error: unexpected argument 'x'\n`,
exactly **44 bytes**. Caps **1, 2, 16, 33, 34, 35, 43** produce the selected
emergency; **44 and 45** retain status2 and the normal 44-byte diagnostic.
Independent controls cover scalar stdout cap1/exact2, false-result status1,
help/version tiny caps, exact version output and matching-output cap1/exact2.
Shell/registry runs reproduce cap1 emergency and cap44 normal diagnostic.

Four hostile-token controls include a marker, quoting/control characters,
multibyte Unicode and a 256-character token, with an attacker-chosen command
name. All produce identical emergency hex, no stdout and zero worker jobs.
Source inspection confirms `syntax.ts:19` checks the complete normal diagnostic
size, `Budget.check` constructs the fixed `output bytes limit exceeded` message,
and `index.ts:62` uses a literal `expr: ` prefix. Neither the token nor command
name enters this emergency text. This does not assert every other error path
has been sanitized or correctly budgeted.

## Blocking normal-quota failures

`src/commands/expr/index.ts:59` catches errors and `:62` publishes every selected
error message without another output-quota check. The parser checks its own
diagnostics, but arithmetic, argument-validation, other limit errors and worker
diagnostics can reach this unchecked write. In particular, `evaluate.ts:60`
throws `ExprError('division by zero')` directly. This violates the user's
**normal writes never bypass normal quota** condition; it is not waived as an
additional emergency category.

| Failing controls | Actual status | Actual normal stderr | Bytes / cap |
| --- | --- | --- | --- |
| `division-cap-1`, `division-cap-22` | 2 | `expr: division by zero\n` | 23 / 1 or 22 |
| `modulo-cap-one` | 2 | `expr: division by zero\n` | 23 / 1 |
| `noninteger-cap-one` | 2 | `expr: non-integer argument\n` | 27 / 1 |
| `nul-cap-one` | 2 | `expr: NUL is not supported in argv\n` | 35 / 1 |
| `unicode-cap-one` | 2 | `expr: argv must contain well-formed Unicode\n` | 44 / 1 |
| `argument-budget-cap-one` | 3 | `expr: aggregate argument bytes limit exceeded\n` | 46 / 1 |
| `work-budget-cap-one` | 3 | `expr: evaluation work limit exceeded\n` | 37 / 1 |
| `regex-invalid-cap-one` | 2 | `expr: Invalid regular expression\n` | 33 / 1 |
| `stdout-rejection-normal-quota` | 3 | `expr: execution or output failure\n` | 34 / 2 |
| `shell-division-quota` | 2 | `expr: division by zero\n` | 23 / 1 |

All eleven failures retain exact inputs, expectations, actual bytes/status and
failed assertions. The stdout-rejection diagnostic happens to be 34 bytes but
is **not** the authorized constant and therefore is **not** exempt. Cap23 for
the 23-byte division diagnostic passes as a normal-boundary control. Every
failing case has empty accepted stdout. The direct-sink quota assertion also
counts attempted bytes; each listed stderr independently exceeds its cap,
so the finding does not depend on charging a rejected stdout attempt.

## Awaiting, abort and owned-resource controls

- Held emergency stderr, normal stderr and stdout keep invocation unsettled
  until their write gate resolves. Every direct invocation attempts stderr at
  most once; no rejection handler retries the diagnostic. Exact emergency byte
  attempts are counted separately from other normal output, not by length alone.
- Rejecting emergency or normal stderr preserves the exact sink-error object.
  A rejected stdout attempt exercises the distinct unchecked normal-error
  failure above, without leaking the attacker-controlled sink message.
- Preabort emits nothing and acquires no session. Abort during held emergency
  stderr or stdout preserves the exact errno-shaped `ENOENT` abort reason.
  Subsequent sink rejection is observed: **zero unhandled rejections**. This
  does not claim cancellation can undo writes or await opaque uncooperative sinks.
- Overlapping cleanup calls share the same promise, with and without a real
  regex worker. Registered cleanup and invocation `finally` result in one
  session-close call, no duplicated acquisition/job/termination. Registration
  precedes session opening for every nonpreaborted direct invocation.
- Real worker controls cover match success, worker syntax error, emergency
  sink rejection, overlapping cleanup during an emergency write, and abort
  immediately after a real worker request. Each expects exactly one worker and
  one posted job; nonregex cases expect zero. All rows have **zero owned workers
  at invocation settlement and after repeated cleanup**; safety termination
  count is **zero** in both runs.
- Main-thread product import hooks reject matcher/compiler module imports and
  confine product resolution to the frozen build or Node builtins. Actual
  workers start only from the frozen `regex-execution/worker.js`. The inspected
  expr entry/parser/evaluator contain no dynamic regex execution, and
  `bre-worker.ts:273` rejects execution on the main thread. No hostile regex
  workload executes on the main thread; these are bounded `a` / `[` controls,
  not a regex fuzz/performance or universal JavaScript-sandbox claim.

## Integrity and historical evidence

Both runs compare **full entry sets**, including appended files/directories,
for the archive/build, development dependencies and both existing evidence
trees. Build additions are restricted to declared `dist` entries plus the
explicit development-dependency symlink. Archive tar hashes and frozen driver
hashes are checked again after execution. Inventories capture paths, entry
types, symlink targets, sizes and file SHA256s; they are observation-time
checks, not a transaction, permissions audit or transient-mutation detector.

The prior `fixture-output-contract-20260827` and
`qualified-final-review-20260827` reports were read. All **82** and **79**
respective inventory entries remain unchanged. The original frozen **11/12**
is still **11/12**, not rescored under the newly chosen policy. Its
`before-01/runtime-frozen.json` SHA256 remains
`e4996ee9ad9c0a1c5240379f2f2aeee041606547de5f05851a914d6230176605`.
No historical replay or default capture writer was run.

Each capture uses a fresh task-owned `.owned-*` archive directory. Its bounded
probe child exits normally, all cooperative worker terminations are awaited,
and the owned scratch directory is removed with absence recorded. No SIGSTOP
is used; timeout fallback is SIGTERM. No other worker's children, scratch,
staging or source are touched. Two runs reproduce the same 36/47 result; this
is **not 72/94 independent coverage**. No full gate, public-consumer, deployed
provider, native semantic parity, performance or superiority claim is made.

## Explicit reproduction

`node tests/commands/expr-stress/output-emergency-review-20260827/capture.mjs --capture fresh-name`
requires a new nonexistent output directory and replays only the pinned
candidate/frozen controls. It never overwrites an existing capture. The
freeze's exact development dependency inventory must still match. Capture
exit0 means collection/integrity succeeded, **not** that acceptance passed.

`node tests/commands/expr-stress/output-emergency-review-20260827/seal.mjs --verify`
verifies the complete sealed review entry set, frozen controls, exact repeated
results and preserved old 11/12 evidence without executing product tests.
Adding a fresh capture intentionally invalidates the sealed entry set; use a
separate authorized copy for future reproduction, never rewrite this seal.

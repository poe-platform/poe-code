# Issue 670: bounded portable expr matching

## Validated request and scoped outcome

On September 8, 2026, the current issue and source agreed: expr already forwarded
matching through the selected executor, but the package-owned bounded provider
rejected every `expr-match` descriptor. Its selection admission accepted only
grep/rg, and its expression error envelope always reported `unsupported`.

Before implementation, six new focused controls failed. In an actual in-memory
Shell with `portableAgentCommands({ provider: createBoundedRegexProvider() })`,
`expr abc : 'a.*'` returned exit 2 and the reported unsupported-selection error
instead of `3\n`, exit 0. A syntax-error control also showed the incorrect blanket
`unsupported` category. These are concrete RED results, not inferred failures.

The scoped implementation now supports conservative portable ASCII BRE expr
matching using the existing bounded BRE implementation. It does not change
exports, preset wiring, networking, host execution, or other regex modes.

## One engine, two execution hosts

- `src/commands/expr/bre-engine.ts` factors the parser, capture validation,
  compiler, and matching VM into `matchExprSteps`, an internal resumable generator.
  It has no Node import and does not call native RegExp.
- Existing charges for work, allocation, parser depth, nodes, capture groups,
  and states remain intact. Metered checkpoints yield during parsing, compilation,
  and matching. Precharged symbol/token/backreference/class scans also expose
  checkpoints in bounded chunks rather than doing a whole large scan between
  event-loop opportunities.
- `src/commands/expr/bre-worker.ts` retains the main-thread rejection and drains
  the same engine synchronously inside the existing Node worker. Node profiles,
  matching order, native worker policy, and existing configured caps remain
  unchanged; the neutral engine is not a native regex fallback.
- The bounded provider drives the generator using the existing environment-neutral
  `yieldTurn` and its endpoint's AbortSignal. Cancellation is checked before each
  resumption, and the existing executor startup/request deadlines remain active.
  Retirement still aborts and drains endpoint work before returning capacity.

Six original Node results were captured before factoring. New engine tests pin
their exact work counts: 63, 169, 550, 193, 265, and 137, including a Unicode
capture. Checkpoints do not consume additional Node work units or relax any cap.
Portable-only request ownership costs are separately charged as described below.

## Portable admission, semantics, and limits

- Admit exactly one subject row with `all: false` and `terminated: false`.
  Request, descriptor, nested limits, and row fields require supported own data
  fields; accessors and malformed arrays fail closed. Typed-array intrinsic
  lengths/buffers are used for admission and snapshots.
- Copy pattern bytes, subject bytes, and limit values before asynchronous work.
  Enforce the minimum of descriptor and provider caps for pattern/input bytes,
  work, allocated units, and states. Preserve descriptor node/depth ceilings.
  Provider defaults and maxima are not raised.
- Pre-admit and charge `patternBytes + subjectBytes + 64` ownership units against
  both allocation and work. This reserves request snapshots and fixed metadata.
  Matching/symbol/compiler charges consume the remaining same request allowance,
  and returned `steps` includes this portable ownership charge.
- Reserve 32 result bytes for the at-most-two overall/capture ranges before
  execution. A provider with a smaller result cap rejects expr, including cases
  that might ultimately return fewer spans; this is a conservative reservation,
  not a promise to exploit every smaller result cap.
- Support non-NUL ASCII patterns and subjects in both `byte` and `utf8-scalar`
  descriptors. This supports ASCII commands in C and C.UTF-8 without claiming
  portable Unicode matching. Non-ASCII/NUL inputs remain explicitly unsupported;
  the explicit Node provider retains its prior broader profiles.
- Preserve anchored matching from offset zero, longest overall match selection,
  existing capture tie behavior, first-group byte offsets, empty/nonmatches,
  bounded groups/backreferences, intervals, and supported ASCII classes.
  Existing unsupported escapes, collating forms, and nullable-repetition
  backreference exclusions remain errors.
- Preserve distinct `syntax`, `unsupported`, and `limit` expression replies.
  Grep/rg execution and their unsupported modes are unchanged. No provider-level
  disposal or caller-shared-provider destruction is added.

The scheduler and accounting bound cooperative engine work on a trusted
JavaScript host. They do not isolate hostile host JavaScript, preempt arbitrary
callbacks, establish atomic snapshots against concurrent shared-memory mutation,
or provide an RSS sandbox. No ambient filesystem or network capability is added.

## Tests and handoff

New maintained test paths:

- `packages/safe-bash/tests/commands/regex-execution/bounded-expr-provider.test.ts`
- `packages/safe-bash/tests/commands/expr/bre-engine.test.ts`

The old blanket-unsupported assertion in `bounded-provider.test.ts` now checks
the still-unsupported `\w` syntax rather than rejecting a newly supported literal.
The separately authorized help correction in `src/commands/expr/command.ts`
preserves usage/tokens and replaces the obsolete worker-only claim with bounded
provider-driven BRE and provider-dependent profiles: built-in portable non-NUL
ASCII versus Node C/POSIX byte or C.UTF-8 scalar. The existing help case in
`tests/commands/expr/diagnostics-regression.cases.ts` first failed against the old
wording and now asserts these distinctions while retaining its usage and virtual
name/version checks. Its focused command is:

```sh
PATH="$(cat /tmp/kamilio-toolchain.path)/bin:$PATH" node --import tsx \
  --test-name-pattern='empty invocation guidance' \
  tests/commands/expr/diagnostics-regression.cases.ts
```

New tests use virtual memory filesystems/owned byte arrays, not disk fixtures.
The active deadline control uses an owned mock clock; cancellation checks cover
falsey reason identity, retirement, and provider capacity reuse. A separate
control disables Node immediate scheduling and makes native RegExp construction
fail, while portable matching and work-limit rejection still succeed.

After implementation, the following scoped run passed all nine files (exit 0,
approximately 6.57 seconds) on Node v22.22.0 selected by
`/tmp/kamilio-toolchain.path`, from `packages/safe-bash`:

```sh
PATH="$(cat /tmp/kamilio-toolchain.path)/bin:$PATH" node --import tsx --test --test-concurrency=1 \
  tests/commands/expr/bre-engine.test.ts \
  tests/commands/regex-execution/bounded-expr-provider.test.ts \
  tests/commands/regex-execution/bounded-provider.test.ts \
  tests/commands/regex-execution/default-provider.test.ts \
  tests/commands/regex-execution/node-provider.test.ts \
  tests/commands/regex-execution/provider.test.ts \
  tests/commands/expr/regex-protocol.cases.ts \
  tests/commands/expr/regex-limits.cases.ts \
  tests/commands/expr/abort-reason-regression.test.ts
```

The engine/provider tests execute current source. Native transport controls use
the existing built worker until root rebuilds it; this run does not establish a
fresh packed/public Node build, browser/workerd acceptance, or a full gate pass.
Root owns registration, build/type checks, public packed-runtime checks and help
screenshots, broader tests/lint, preset documentation, and Git/release operations. Issue 669's
delivery remains separate from this subsequent feature. No leaf Git operation,
root export, bundler, manifest, README, or root-owned plugin-test edit is made.

# Expr local output-quota author V2 — August 27, 2026

Source candidate: **`c25e682a7baa2f2abf70cebf8c01d11d0ad5daee`**.
The local diagnostic admission bug is fixed. New regressions pass **85/85** in
both committed-candidate runs. Unchanged independent controls remain **46/47**
in each run, and unchanged adjacent tests remain **302/303**: both remaining
assertions require recasting a stdout sink rejection, contrary to the user's
new explicit identity requirement. Neither old assertion is changed or rescored.

## Cause and exact change

The old entry catch wrote normal diagnostics directly to stderr without output
admission. Parser diagnostics had their own check, but arithmetic, argv,
resource, worker and unknown errors bypassed it. The same catch surrounded the
stdout sink write, turning a caller's sink failure into a product diagnostic.

Only `src/commands/expr/index.ts` changes production behavior:

- Normal diagnostic admission checks `message.length + 7` and then
  `Buffer.byteLength(message) + 7` through existing `Budget.check`, before local
  interpolation and encoding. This bounds the command's diagnostic allocation;
  it does not pretend to undo an already-created host error string.
- Only failed admission takes the fixed literal emergency branch:
  `expr: output bytes limit exceeded\n`, exactly **34 bytes**, status 3.
  It is awaited, contains no user tokens/name, and has no retry path. The normal
  and emergency stderr writes are outside the admission try/catch.
- The normal stdout write moves outside the expression/diagnostic catch.
  Rejection is not output-admission failure. Sink error identity is preserved,
  including quota-shaped errors and falsy rejection reasons.
- Normal stdout admission remains in place. This is not an absolute combined
  stdout/stderr byte cap. Emergency output alone is exempt; ordinary resource
  diagnostics do not gain a second exemption. Diagnostic reporting does not
  spend an already-exhausted work/string budget.
- Shared ByteIO, Budget, cleanup and regex lifecycle contracts are unchanged.
  Cleanup still registers before session acquisition and awaits an idempotent
  shared close; signal checks and exact caller reasons remain unchanged.

No parser, evaluator, shared, root/export/package, dependency or other production
file was edited by this leaf. The new focused test is the only other core-commit
file. The README correction and these artifacts are a separate docs/evidence
commit. No delegation, native recapture, product subprocess or main-thread
untrusted regex was introduced.

## Candidate and freeze

| Binding | Value |
| --- | --- |
| Entry source SHA256 | `b1ad46e35f4077659aee2d148ab30a1ac6ba4032a877669ae2c5bfb27447c7fa` |
| Committed selected archive SHA256 | `5a7cb9fd1ac93fa2ef9f2ed2b66c1c489c415c62d3869718d30385e82773a596` |
| Original input freeze | 2026-08-27 20:48:05.622 UTC |
| Original committed baseline | `1b2ddea9e38b25cc91134a2f35a318e27f4d7c29` |
| run01 | 20:50:43.973–20:51:01.424 UTC |
| run02 | 20:51:26.780–20:51:41.681 UTC |
| Host | Node v22.22.2, Darwin arm64 |

`FREEZE.json` precedes the source edit and binds all 47 original inputs and
assertions, their unchanged driver, the new author regression, development
dependencies and three historical evidence trees. `FREEZE-v2.json` explicitly
records a subsequent **erased type-annotation-only correction** to the new test:
`this: TextEncoder` becomes `this: InstanceType<typeof TextEncoder>`. The
precorrection test is preserved verbatim as `regression-pretype.ts.data`.
All runtime inputs and assertions remain identical. The V2 binding follows
development execution and precedes the core commit; it is not misrepresented
as a second preimplementation holdout. The new capture driver differs from the
original author driver only in its own filename and freeze filename.

The selected archive consists of committed `src`, package/lock/build configs,
`tests/commands/expr` and `tests/commands/expr-author`. Both final runs extract
exactly the core commit and use **no live source overlays**. Later live parser
or index edits do not enter or veto this candidate. The index handoff was
published immediately after the core commit at
`/tmp/expr-quota-author-v2-20260827-candidate.txt`; this leaf makes no later index
changes without root coordination.

## Results and limits

| Check, each final run | Result |
| --- | --- |
| Selected committed source/declaration build, `skipLibCheck=false` | PASS |
| Strict source + expr tests + top-level expr-author TS inputs | PASS |
| New `output-quota.test.ts` | **85/85** |
| Unchanged independent 47-control probe | **46/47**, one preserved policy conflict |
| Selected unchanged adjacent tests | **302/303**, one preserved policy conflict |
| Owned worker safety terminations / live at settlement | **0 / 0** |
| Unhandled late rejections / main-thread matcher import violations | **0 / 0** |

New tests cover normal exact-byte boundaries and just-below/tiny caps for
syntax, arithmetic, invalid argv, resource exhaustion and real-worker errors;
stdout boundaries; unknown errors; multibyte transport errors; checking before
large diagnostic encoding; fixed hostile-token output; rejection identity for
all output destinations; held sinks; shared awaited cleanup; and caller abort
with falsy and errno-shaped reasons. Existing abort regression coverage retains
the structural `undefined` reason controls. The independent unchanged probe
also exercises real Shell/registry execution and real worker cleanup.

Adjacent runtime files are only `contracts`, `grammar`,
`diagnostics-regression`, `abort-reason-regression`, `regex-lifecycle` and
`regex-limits`. Native test files are included by the existing strict TS config
but **not executed**. The independent probe imports the archived compiled
product; author/adjacent tests use archived TS through the inventoried tsx
installation, with worker code from that archive's fresh build.

Repeated runs are repetitions, not 170 independent new tests or 94 independent
controls. There is no full/global gate, root-export/public-consumer, native
parity, provider, performance, superiority or 72-hour-completion claim.

## Preserved conflicts

`stdout-rejection-normal-quota` keeps its original argv `['1']`, cap2 and
rejecting stdout sink. Its old expectation is status3 plus emergency stderr.
The candidate instead rejects with the **same sink object**, status unset,
stdout/stderr empty, and zero diagnostic attempts. Only its exact-result check
fails; its normal-byte admission and lifecycle checks pass.

`tests/commands/expr/contracts.test.ts:138` similarly expects the rejected
stdout sink to become status3 plus an output-failure diagnostic. The unchanged
test now fails with its original `sink failure` error. It is not weakened or
excluded. `SINK-IDENTITY-V2-PROPOSAL.json` records the exact proposed replacement
expectation and reason, separately from the historical controls. New author
identity tests supply versioned coverage without force-greening either cohort.

The old independent **36/47 twice**, including all original **11 failures**,
remain unchanged. Ten of those failure rows now pass; the sink-recasting row
remains red for the explicit requirement conflict. The old original **11/12**
and approved V2 **12/12** remain distinct historical results, not current whole
output-policy acceptance.

## Development receipts and integrity

- `development01`: strict source build passes; new test strict typing fails
  TS2749. Before runtime, full-entry integrity also rejects TypeScript's
  `node-compile-cache` additions under the owned scratch. Both receipts and
  the appended entries are retained. Scratch is removed.
- `development02`: disabling compile caches removes that harness side effect;
  original test still has the recorded type error. Runtime is 85/85, 302/303,
  46/47. No source change follows this run.
- `development03`: the type-only correction makes strict types pass. Runtime
  remains 85/85, 302/303, 46/47. These development runs explicitly overlay only
  the owned source and new regression onto selected committed baselines; they
  are not the final committed-candidate proof.

Both final runs compare full entry inventories before/after, detecting added
entries as well as changes/removals in selected input/build and dependency
trees. Build-only additions are restricted to `dist` and the declared
dependency symlink. Frozen controls and archive hashes are rechecked. Historical
inventories preserve all 24, 82 and 79 entries respectively in the independent
emergency, fixture-output and qualified-final-review trees.

`additional-history.json` separately compares all **37** approved-author and
**77** approved-independent entries to the original committed baseline and
current live trees. This is an explicit **postcandidate preservation audit**,
not an invented preexecution inventory. It establishes exact entry equality
including additions, and does not rerun or rescore those old 12-control cohorts.

All task-owned scratch directories are absent after execution. Children have
bounded timeouts using SIGTERM, never SIGSTOP. Cooperative worker termination
is awaited and no safety cleanup was needed. Opaque late sink work is observed,
not claimed to be forcibly cancellable. Integrity checks are observation-time
checks, not a mutation-proof transaction or guarantee about later edits.

## Explicit reproduction

To replay without overwriting captures, use an authorized separate copy of this
evidence tree and a new name:

```sh
NODE_DISABLE_COMPILE_CACHE=1 TSX_DISABLE_CACHE=1 node tests/commands/expr-stress/output-quota-author-v2-20260827/capture-v2.mjs --capture c25e682a7baa2f2abf70cebf8c01d11d0ad5daee fresh-name
```

Capture exit0 means collection/integrity completed, **not all assertions pass**.
Exact frozen dependency/control inventories must still match. Do not append to
the sealed original tree; new captures would intentionally invalidate its seal.
`node tests/commands/expr-stress/output-quota-author-v2-20260827/verify.mjs --verify`
checks the full sealed entry set, candidate archives, repeated counts and
preserved historical evidence without executing product tests or writing
canonical artifacts.

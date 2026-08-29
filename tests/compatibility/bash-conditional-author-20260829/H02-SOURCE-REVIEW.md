# H02 source/data clarification — 2026-08-29

No product, native, compiler, package, or test execution in this clarification.
No production/fixture correction or acceptance is implied. Original H02 fails
in all three layouts; the original 750/753 main outcome remains unchanged.

## Frozen authority

- Source commit: `6fde455bcc103117a6424b95156b152721f5735f`.
- Selected computed tree: `501ad98748e639c909f717007dac4f1da19c67dc`.
- `SOURCE-v3.json`: `74c94ab8fb9531f5a704e51d12b6ab713280541758f36cd03de51fe0d630d4da`.
- Package, 954 members: `4df8658746a881fd1316e403a234fd941baccfdead7a9518bc39fa7f6df2bb6e`.
- Prior evidence: `97eba3743f4c00998d5f0f4c05cc2e0bbc04e1cd`.
- Exact `conditional.mjs` SHA256, matching EXECUTOR-v3 and retained source consumer:
  `29593d551f6e4fe310907036b82d9f3494ac0b76780ae6008ef4b5cb1647af25`.

Source lines below refer to the frozen selected source, not moving HEAD. Seven
relevant retained source files were rehashed against SOURCE-v3 before inspection.
Source bytes were read from `/tmp/conditional-author-fhvyDt/source` without imports.

## Exact fixture and observations

`conditional.mjs:61` runs `[[ -f file ]]` with cwd `/`, an explicitly supplied
caller AbortController, and a Proxy around MemoryFileSystem. Only `stat` is
overridden; other methods retain their receiver. The override ignores the path:

```js
stat: async (_path, options) => {
  try {
    controller.abort(reason);
    options.signal.throwIfAborted();
  } finally {
    await new Promise(resolve => setImmediate(resolve));
    closed = true;
  }
}
```

`reason` is the frozen object `{ during: true }`. No file, socket, stream or
descriptor is acquired by this override. Its explicit acquisition is one
Immediate-backed promise. It does not register cleanup, return a resource handle,
or provide any other completion observer. `FsOptions` supplies only the signal.

The test first awaits public rejection and asserts **reference identity** with
`reason`, then asserts `closed === true`. Raw RESULT-v3 has the same failure at
`conditional.mjs:61:499` in source, installed, and moved: `false !== true`.
Thus the reason assertion passed; the provider finalizer flag was false at the
assertion following public rejection. The row wrapper then awaited Shell.dispose:
each row records created=1, disposed=1, cleanupFailure=false.

There is **no later observation of `closed`** in the fixture or its raw row.
Disposal fulfillment and eventual natural process retirement are recorded, but
neither is a timestamp/counter observation of this provider's delayed finalizer.
Do not claim finalizer completion before/after dispose, no leak, or cleanup success
for that operation. No deadline forcing is reported for these H02 consumer runs.

## Chronology and promise ownership

1. The Shell creates a root invocation scope and cancellation owner; the owner
   registers its admission-closing callback (`shell.ts:31`). This is framework
   registration, **not registration of the fixture's stat promise**.
2. Runtime visits the conditional and awaits `evaluateConditional`
   (`runtime.ts:1519`). Unary evaluation calls and awaits `fs.stat('/file',
   { signal })` (`conditional.ts:116`). There is no unawaited/fire-and-forget
   stat call introduced by the conditional implementation.
3. Inside stat, abort is requested synchronously; the supplied signal throws.
   The override enters finally and schedules the Immediate. Its async stat
   promise cannot reject until that finally completes. This ordering is a
   source-level consequence; there is no instrumented event timeline in H02.
4. The shared outer execution has cancellation races: `interruptible` uses
   Promise.race (`runtime.ts:130`); Shell wraps runUnit with it (`shell.ts:271`).
   RootInvocationCancellationOwner also captures cancellation in a microtask
   while observing, rather than awaiting, the raw execution promise
   (`shell.ts:46–74`). These allow cancellation to win before provider settlement.
5. Public exec **does await root scope.close** before outcome selection
   (`shell.ts:184–190`). Scope.close drains registered callbacks and nested
   scopes (`cleanup.ts:46–58`), not every pending promise anywhere in the evaluator.
   The provider's stat/finalizer promise is not among those callbacks/children.
6. Public rejection is observed with the original caller reason while the flag
   remains false. The fixture's later dispose drains active registered scopes and
   finalized cancellation owners (`shell.ts:307–335`); an already-removed root
   (`shell.ts:188`) does not become a provider-promise registry through dispose.

The evaluator awaits stat; its callers await the evaluator on the ordinary path.
The public cancellation barrier does **not** await that raw work to settle once
cancellation wins. Rejection observation is not the same as completion ownership.
No H02 observation demonstrates a failure of a registered cleanup callback.

## Contract/source classification

`contracts/filesystem.ts:41` declares only `FsOptions.signal`; stat/lstat at83–84
return metadata promises, with no cleanup-registration or retained-handle seam.
`contracts/command.ts:21,35` exposes explicit cooperative invocation cleanup.
The accepted cleanup contract does not promise to await arbitrary opaque host
promises or preempt host code. The concrete scope implementation supports that
distinction; its drain contains registered callbacks/children only.

**Recommended classification for root adjudication:** H02 asserts a stronger
provider-finalization barrier than the existing explicit-enrollment contract.
It exposes a preexisting shared cancellation/ownership boundary through a new
conditional path, not a demonstrated dropped await in the new helper. The fixture
effect is finite/cooperative in practice, but is *unenrolled*; finite duration does
not itself make it an owned invocation resource.

This is SOURCE-qualified, not a replay proving historical baseline behavior.
Existing `commands/predicates.ts:6–11,77` also awaits metadata with the supplied
signal; its identical source offers a prior-path analogue, not an executed H02
baseline. If root intends **all** shell-started VFS promises to be drained after
abort, that is an additional shared ownership decision, potentially blocking on
opaque providers; this review cannot silently adopt it or exempt the new helper.

Unchanged source SHA256 bindings:

| File | SHA256 |
| --- | --- |
| src/shell/shell.ts | 126438b132a9f1863bf25b20f02ca6473cb24aa86e0a91869ab98bcbf3309cba |
| src/shell/cleanup.ts | 134f55641d6437681cd185960a2923d68086096921758717c5b8059595304385 |
| src/contracts/command.ts | d2f6c788a48b3bb0bed9570f0e69bb2bfab845528376a7fe9288d1c07556df7c |
| src/contracts/filesystem.ts | e2343faf818a15ad7afc06618b3f8856cf14f36c86574cc49c85d51a13e7e522 |
| src/commands/predicates.ts | ca98df3ffbc6939007fd73939ad40b67028dfe66c1129a3647fbb061213bd347 |

Changed conditional/runtime SHA256 bindings are respectively
`ff6bb8f28a7162a7936dcb53b1ecb1b022e083e78ce03a11771e780994ef448c` and
`6f42b2a8b649a0c6c6377be407cf7d3b2e248bf0081a25e8e1d8a89c80cba46b`.

## Minimal alternatives — proposed only

**Fixture-version proposal, if root confirms the existing ownership contract:**
preserve original H02 unchanged. A separately versioned observation should retain
exact caller reason and independently controlled provider release/completion,
record public settlement and finalizer completion separately, then release/await
the fixture-owned provider in test finally. Do not replace the old assertion with
an unconditional pass, a timeout, or a claim that dispose owns this promise.
An additional explicitly enrolled cooperative-cleanup control should register
before acquisition and prove public settlement waits for that registered hook.
Its result would be new-contract-binding evidence, not an H02 rescore.

**Product alternative, only if root requires the stronger guarantee:** define
which provider operations are trusted/cooperatively drainable and enroll them
before activation; cover abort during acquisition and late completion. Merely
registering every arbitrary pending stat promise could make public cancellation
hang indefinitely and changes shared behavior beyond this unit. There is no
minimal justified conditional-only patch established by current observations.
No correction is applied here; Plato/root must adjudicate this boundary first.

## Exact role of the 50 new author identities

All 50 have product-profile expectations, not GNU-native goldens. No original
design/native cohort is credited by matching an author case name or similar text.

| IDs | Product-profile role |
| --- | --- |
| A01–A05 | empty/nonempty, no splitting/globbing, quoted closing delimiter |
| A06–A13 | basic C-profile pattern and quote/escape/variable provenance |
| A14 | reached extglob **unsupported refusal**, not extglob compatibility |
| A15 | quoted extglob lookalike is literal data |
| A16–A21 | lazy effects/nounset, precedence/grouping, operator data, one substitution |
| A22–A24 | file/empty-path/link/size/access selected VFS semantics |
| A25–A28 | variable/empty/sparse-array presence and actual option state |
| A29–A32 | C ordering, restricted literal numerics, empty zero, expanded $# |
| A33–A34 | arithmetic expression and ERE **unsupported refusals** |
| A35–A40 | skipped ERE, redirection, function/pipeline, errexit/nounset boundaries |
| H01 | preaborted exact reason and no metadata call |
| H02 | delayed unenrolled provider-finalizer assertion: **FAILED/CONTRACT OPEN** |
| H03–H06 | skipped metadata, genuine limit, exact sink/provider errors |
| H07–H09 | standalone syntax, AST/caps, ERE refusal without capture mutation |
| H10 | unobservable permissions **unsupported refusal**, not permission parity |

Thus 40 script checks +10 host checks; 49/50 per layout, with H02 not accepted as
a resolved supported-profile guarantee. A14/A33/A34/H10 verify deliberate refusal
boundaries; they are not implementation of their unsupported native features.
All GNU-reference executions remain UNRUN, including diagnostic/status byte
qualification, unary/arity ambiguities, advanced patterns/arithmetic/ERE and array
edges. Original design40+host10 remains its separate unrun cohort. Unit2's11 open
design IDs remain open; these selected tests do not close those wider domains.

## This inspection's limits and helper record

Only source/data reads and report publication; retained roots were not mutated.
Outer inspection capture: `/tmp/bash-conditional-h02-source-CwjSng`.
One read helper attempted the old installed consumer path after authenticating
the source consumer and failed ENOENT. Physical movement means the former path
cannot be assumed present. The helper exited1, no product was loaded, no retry
or new installed-layout authentication is claimed. Its complete error is retained
in tool transcription; source excerpts were captured before the read failed.
Prior installed/moved outcomes above come from immutable RESULT-v3, not this read.
No new resource-lifecycle telemetry was collected.

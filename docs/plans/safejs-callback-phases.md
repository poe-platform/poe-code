# Realm-owned callback phases

Issue: #547

## Contract

- Expose `startCallback(callback, options)` on the realm and extension context.
- Return immutable handles: `synchronous: Promise<void>` and `result: Promise<unknown>`.
- Synchronous completion means the guest function returned or its own async body reached its first suspension, not an interpreter implementation await or cooperative yield.
- Ordinary throws reject both handles. Nonfatal async-function rejections reject only the result, including rejection before the first await.
- Keep `invokeCallback` as the final-result convenience API, with the existing ownership, invocation limits, cancellation and reentry rules.
- Observe both native promises internally so a host may consume either handle without producing unhandled native rejections. Neither observation swallows the rejection visible to consumers.
- Fatal execution and cancellation reject every still-pending handle. Already-completed prefixes stay completed.
- Do not add browser event policy, native evaluation, new grants or unbounded queues.

## Implementation and validation

1. Add failing public/core tests for phases, failures and lifecycle.
2. Reuse the interpreter's async-prefix signal in the realm callback execution path; retain and release invocation state until the result settles.
3. Verify receiver/argument identity, nested dispatch, overlap, pending limits, cancellation, budget yields and cleanup.
4. Add a public Node/Bun package consumer fixture and type-check the exported interface.
5. Run focused and complete SafeJS tests, normal commit/push checks, GitHub releases, clean installed consumers and provenance verification.
6. Close #547 only after the published package passes verification; resume issue monitoring.

## Reproductions found

- The initial six tests failed because the public API was missing.
- An overlapping-start test exposed a queue reservation race: an idle realm deferred its first callback's queue entry until after a later callback. Reserve the queue slot before the execution wrapper's deferred work.
- Closing or aborting while an authorized host operation waited inside an unfinished prefix timed out. Route that native result through the existing cancellation wrapper, and drain the native promise when its signal is already aborted.

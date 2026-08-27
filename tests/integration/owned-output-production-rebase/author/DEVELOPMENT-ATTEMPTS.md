# Author development attempts

These are author-owned new fixture iterations, not changes to historical inputs
or existing regression tests. No oracle/golden input was changed.

1. Initial operation run: 10 tests, 9 pass, 1 fail. The assertion at original
   `operation.test.ts:140` expected cleanup completion order
   `["second", "third", "first"]`; actual was `["third", "second", "first"]`.
   The approved contract orders reported errors, not concurrent callback starts.
   The corrected assertion requires both undelayed callbacks before the gated
   callback, while retaining exact `[first, second]` AggregateError identity/order.
2. Initial combined operation/Shell run: 23 tests, 21 pass, 2 fail.
   - Original `shell.test.ts:203` expected an unregistered raw provider generator's
     delayed finally to delay public settlement. Actual public execution settled.
     S1 cat registers its wrapper iterator return; `readBytes` explicitly does
     not await arbitrary underlying iterator return after abort. No new raw-host
     promise guarantee is inferred. The revised fixture explicitly registers
     provider cooperative completion in middleware **before** calling `next`;
     it tests that registered work is drained and operation cancellation reaches
     the provider without aborting the whole command signal. This fixture
     semantic correction is disclosed; it is not unchanged-input proof. Delayed
     unregistered raw-provider settlement remains outside the approved guarantee.
   - Original `shell.test.ts:218` expected `head -c 1; cat` on one `"abc"` input
     chunk to return `"abc"`; actual was `"a"`. Existing head consumes the whole
     delivered chunk; no implicit byte cursor handback is approved. Revised
     sequential-cursor fixture supplies chunks `"a"`, `"bc"` and retains the
     required `"abc"` expectation. No input.ts/head implementation change.

The tests above were executed directly before an explicit capture driver was
added. Their exact failure diagnostics/expectation differences are retained here;
no claim is made that this narrative is a saved full raw TAP capture.

3. Captured `runs/focused-01`: 38 tests, 36 pass, 2 fail. Both redirect cases
   called a nonexistent author-fixture method `MemoryFileSystem.exists`.
   Corrected to the actual public `stat` API with typed `FsError.code === ENOENT`;
   the absent-body requirement is unchanged. Raw TAP and exact test input hashes
   remain in the original capture, which was not overwritten.

4. First focused no-emit TypeScript invocation reported two owned-source
   TS2304 errors at `src/contracts/output.ts:90` and `:99`: contextual generic
   method implementation did not bind the name `Value` locally. Corrected the
   implementation to explicitly declare the already-approved generic signature.
   No new exported API, foreign fix, build or root dist write was involved.

5. `runs/legacy-core-01` (unchanged legacy inputs): 505 tests, 503 pass, 2 fail.
   `tests/commands/network/byte-ownership.test.ts:103` and `:129` both expected
   direct legacy stdin finalization (`closed === true`); actual was false.
   Historical S1's unconditional next-only stdin adapter suppresses `return`
   even for entirely unenrolled sinks. The current explicit requirement says
   legacy unenrolled sinks retain their contract. The rebase therefore selects
   the next-only adapter only when the supplied stdout advertises `ownedOutput`;
   otherwise it preserves the existing stdin object and iterator behavior.
   This uses the already-approved capability as the enrollment boundary, not
   a new field, host hook, heuristic, cursor lease, or handback guarantee.
   Enrolled output still never closes the borrowed cursor. Real Shell forwarding
   retains its existing `ShellInput` cursor semantics. The original failures and
   source/input manifests remain immutable in that run.

6. An initial read-only inline zero-overlay authentication attempt refused an
   incorrect harness assumption that the accepted patch has a `diff --git`
   header. The actual authenticated 662-byte artifact uses `---`/`+++` unified
   headers. No evidence or source was written by that failed attempt. The durable
   `authenticate.py.data` validates the actual format and exact path/hunk counts.

7. Final source inspection found an interaction with the acquisition-drain fix:
   S1 removed signal listeners as soon as normal close began and refused further
   abort propagation. An admitted pending acquisition could then miss a later
   caller/consumer abort during its drain. Keep those listeners until drain
   settlement and propagate abort while admission is closed. Normal close alone
   still does not abort the operation signal. Two new regressions require late
   caller/consumer cancellation to reach a pending child acquisition during
   parent close; no signatures or lifecycle enrollment policy changes.

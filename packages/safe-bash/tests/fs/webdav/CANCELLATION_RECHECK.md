# WebDAV bounded fetch-wait source recheck

August 26, 2026. Implementation-leaf ownership: `src/fs/webdav/**` and
`tests/fs/webdav/**` only. No shell, contracts, independent audit, root
documentation, adapter matrix, dependency or configuration outside this scope
was edited. The scoped tsconfig extends the existing strict root configuration
and disables emission.

## Original evidence stays original

Independent audit commit `4e26ce0` remains **20/24 PASS, four failures**,
identically in its three recorded replays. D02/D05 deliberately supplied
signal-ignoring fetch implementations **outside the documented transport
contract**. They were robustness gaps, not demonstrated native Fetch protocol
failures. S08/D08 were separately identified genuine downstream shell
cancellation failures. Neither classification nor any original evidence was
changed. `git diff --exit-code 4e26ce0 -- tests/stress/remote-cancellation`
passed; every file in that directory also had identical before/after hashes.

The read-only pre-edit four-row probe reproduced **0/4 PASS**. This source
assignment strengthens outward waiting; it does not retroactively change the
original audit verdict. `capture.mjs` was inspected but never executed, because
it overwrites the independent evidence. Only the read-only runner was used,
with stdout/stderr redirected outside its subtree.

## API semantics and implementation

- Each pending fetch-response acquisition races the existing combined caller
  signal/per-request timeout. A pre-aborted request starts no transport. Abort
  stops the outward wait even if the injected promise remains pending; eventual
  settlement never resumes normal response processing or follow-up operations.
- When abort wins, the pending request rejects as `FsError` with the existing
  request method/path and the exact combined signal reason as `cause`.
  Caller cancellation is `ECANCELED`; timeout is `ETIMEDOUT`. Existing catch
  precedence remains: an observed caller abort is classified before timeout.
  Pre-abort still has no cause. Existing outer wrappers such as `writeStream`
  retain their wrapping behavior. Ordinary HTTP translation and uncancelled
  transport failures (`EIO`, original cause) are unchanged.
- Abort listeners added by the race are removed on success, asynchronous
  rejection, synchronous throw and abort. Promise rejection handlers remain
  attached to observe ignored transports that reject later. Late unlocked
  response bodies receive `cancel(signal.reason)` without waiting for cleanup;
  cleanup rejections are observed. No late body is read or reader acquired.
- LOCK compatibility requires more than discarding the late body. A late
  successful response passes the same origin/resource/redirect and token checks
  before a detached, fresh-deadline best-effort UNLOCK. No COPY/MOVE follows.
  Already-known tokens keep the existing awaited best-effort cleanup. UNLOCK
  fetch waits now also settle at their deadline when the transport ignores it.
  Cleanup failure never replaces the operation result.
- The shared internal I/O abort helper is not exported and does not own
  `Response` or late LOCK cleanup. No contract change is needed; the existing
  `readBytes` upload path is retained. The response race is local to WebDAV.

This is bounded API **waiting**, not forced cancellation of trusted host code.
A signal-ignoring fetch can continue running, hold sockets, accept mutations,
or never settle. Its attached observation closure can remain until settlement.
A locked body owned by an injected transport cannot be released by this adapter.
Late response cancellation/UNLOCK cleanup is best-effort and may itself fail or
remain active in the host. Synchronous code cannot be interrupted. Accepted
PUT/MOVE/COPY effects are not rolled back. Missing/untrusted lock tokens and
failed cleanup may leave remote locks until expiry. No global operation
deadline, blanket rollback, transport stoppage or provider certification is
claimed; the existing per-request deadline and body-consumption behavior remain.

## Owned regression coverage

`fetch-cancellation.test.ts` adds 18 deterministic gated tests:

- D02-style pending PROPFIND and D05-style pending GET, caller/deadline abort,
  and late fetch resolve/reject: eight combinations. Each proves settlement
  while the actual fetch is still pending, exact error/cause, no retained race
  listener, and no normal follow-up operation. Late PROPFIND redirects cannot
  trigger canonicalization requests.
- Late response cancellation which remains pending and subsequently resolves
  or rejects: two controls; cancellation reason identity, zero pulls, one cancel
  and an unlocked body are asserted independently of cleanup completion.
- Normal exact-byte success and HTTP failure; synchronous throw, asynchronous
  rejection and cooperative abort; pre-abort: five controls.
- A remote MOVE accepted before cancellation keeps its exact namespace/byte
  effect even though the response remains pending: one non-rollback control.
- Late successful LOCK plus successful or signal-ignoring UNLOCK: two controls.
  Only UNLOCK is permitted after abort; fresh signal/deadline, token cleanup,
  ignored cleanup's late rejection and unchanged source/target bytes are tested.

The four existing acquisition-time LOCK cancellation cases now await explicit
body-disposal and UNLOCK fixture gates, rather than assuming a late response has
arrived before the newly bounded API rejects. All previous cleanup, token,
signal, byte and operation assertions remain. Existing untrusted-token/URL,
redirect, pending LOCK body and deadline-cleanup cases remain in the full suite.
Timers are failure bounds/deadlines, not simulated network progress in the new
tests. No assertion credits forced host cancellation.

## New-source verification, separately labeled

Capture window: **2026-08-26 22:27:49–22:28:09 UTC**. HEAD was
`6c9e5e082d46262bedc8236b05d491edf5635e38` throughout, plus the owned patch.
All source files, executed tests/helpers and original audit hashes were stable
across the window. Concurrent additions to unrelated network/shell test files
are listed in `verification-hash-drift.log`; they were not executed or edited by
this worker. This is not a whole-repository checkpoint.

| Check | Result |
| --- | --- |
| Full owned WebDAV suite, strict unhandled rejections | 308/308 PASS; exit 0 |
| New fetch tests plus existing LOCK cancellation tests, ten fresh processes | 31/31 each; 310/310 executions PASS; all exit 0 |
| Unchanged full shared filesystem conformance suite | 202/202 PASS, including 50 WebDAV cases; exit 0 |
| Owned strict scoped TypeScript check | exit 0 |
| Independent audit strict scoped TypeScript check | exit 0 |
| Unchanged independent four-row probe | 2/4 PASS: D02/D05; S08/D08 FAIL; exit 1 |
| Unchanged independent full audit, three fresh processes | 22/24 each; 66/72 executions PASS, six shell-row failures; exit 1 |
| Owned whitespace check, original-evidence diff and audit hash comparison | exit 0 |

All listed suites/replays report zero skipped/cancelled tests. Existing
capability-specific shared-conformance branches are unchanged; their success
does not assert unsupported capabilities. No assertion or denominator was
relaxed. In the full replays D02/D05 each settled before fixture release (logged
wait rounded to 0 ms, whole case 1 ms), and late GET bodies were cancelled and
unlocked. These are functional deadline observations, not performance claims.
All 27 HTTP fixtures in the full replays reported zero remaining sockets/tasks,
closed listeners and zero fixture errors **after their existing cleanup**;
S08/D08 still required rescue cancellation and remain failures. No watchdog,
residual-process-group or strict unhandled-rejection failures were reported.

S08/D08 source remediation belongs to Sagan's shell assignment. This leaf did
not edit or wait for those fixes. Parent owns the broader final filesystem
checkpoint. Full-shell support, superiority, scope completion and 72 hours of
work are not established by this recheck.

## Reproduction and evidence

All commands run from `/Users/kjopek/Workspace/safe-bash`. Full commands, logs,
exit codes, timestamps, before/after status and SHA-256 manifests are in:

`/tmp/webdav-cancellation-20260826.NxpXdH/`

`verify.sh` contains the complete fresh-process command sequence;
`commands.log` and `exits.log` record its actual invocation/results.
`baseline-four.log` is the pre-edit four-case reproducer. The final evidence is
`owned-full-final.log`, `targeted-repeat-{1..10}.log`, `shared-conformance.log`,
`owned-typecheck.log`, `audit-typecheck.log`, `independent-four.log` and
`independent-full.log`. The independent logs include every ordered event.
`verification-before-sha256.txt`/`verification-after-sha256.txt` cover the source
and test tree; `audit-before-sha256.txt`/`audit-after-sha256.txt` cover every
original audit file. Final owned hashes and commit metadata are recorded there
after the documentation/commit step.

```sh
node --unhandled-rejections=strict --import tsx --test 'tests/fs/webdav/*.test.ts'
node --unhandled-rejections=strict --import tsx --test tests/fs/webdav/fetch-cancellation.test.ts tests/fs/webdav/lock-cancellation.test.ts
node --unhandled-rejections=strict --import tsx --test tests/fs/conformance/shared.test.ts
node_modules/.bin/tsc --noEmit -p tests/fs/webdav/tsconfig.json
node_modules/.bin/tsc --noEmit -p tests/stress/remote-cancellation/tsconfig.json
AUDIT_CASE='S08|D08|D02|D05' AUDIT_VERBOSE=1 node tests/stress/remote-cancellation/run.mjs
AUDIT_REPEATS=3 AUDIT_VERBOSE=1 node tests/stress/remote-cancellation/run.mjs
```

Pinned executed bytes (SHA-256):

| File | Hash |
| --- | --- |
| `src/fs/webdav/webdav.ts` | `e63f010b99184df94c44f49fcbd52e84cc0d3137821637d030dee9651f60dd16` |
| `tests/fs/webdav/fetch-cancellation.test.ts` | `7e44738db6a7c129618e2112568a3b98962c67d6903df2d0cf24d1c6b1b2ce57` |
| `tests/fs/webdav/lock-cancellation.test.ts` | `4d693e51a3a68f1400f407982bc4b07d1ec7b2c9e1ee40ac22b2d7ea0850b1fb` |
| `tests/fs/webdav/tsconfig.json` | `acc4aeeed2da6c84e9516678b995c718d5c87d6a5cf1bdf99484ea1223ee7743` |

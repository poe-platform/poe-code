# Independent queued-close review

## Disposition

The retained second-worker/success expectation is obsolete for the current
invocation-owned close contract. No source regression is demonstrated by these
bounded controls. This is not a passing99/100 replay or public/runtime acceptance.

**Final concurrence: agree with the test-only proposal at adjudicator commit
`6dbd7d06f9c1901602b415773bb33ba1522a1c6e`.** See `POST-HANDOFF.md` for the
separate critical review and exact proposal hash. No source fix is indicated;
canonical application remains the canonical owner's decision, not performed here.

The ready note was initially absent before and after a60-second bounded wait.
`INITIAL.md` was sent through `/tmp/regex-queued-close-reviewer-initial.txt` and
the pending checkpoint committed at `a2c9949`. The note arrived during that
commit; review resumed only afterward. This chronology preserves the independent
freeze and the genuine pending checkpoint instead of implying prior concurrence.

## Independence and provenance

Expectations were committed at `7151577` before independent execution and before
any check of the adjudicator marker. Inputs read: the complete retained
`tests/commands/regex-execution/followup/messageerror.test.ts`, historical/current
client close/queue/retirement implementation, approved contract, and both prior
cleanup-registration and cleanup-boundary-review reports.

- Frozen source: `01aa1bffe0568cc6787d5ff8e0331e024a787385`.
- Approved contract: `07acb1a4d30b7592cf247a0220250317be4e2038`.
- Prior Phase A review: `0b370e33cdb42128c6585cbebd1f6bad02753285`.
- Current client SHA256:
  `1638d492d11d466875b98451a59bace4e60e71fcd5468d671182187549922bca`.
- Protocol SHA256:
  `0b4f9fac518cd31f403c1c0f49e4c7772f783e32df7cfe83ee5d4906426133e6`.
- Historical test SHA256:
  `29b38d1603829e8f914410463b0537752aa585444a990e204b96948b92d14214`.

`run.mjs` reads only frozen client/protocol via git-show, transpiles with existing
TypeScript5.9.3 into ignored owned `.generated/`, and records input/emitted hashes.
There is no live runtime import, full build, typecheck, installed dependency or
native matching graph. This transpilation is not package/public-consumer proof.
Execution: Node v22.22.2, Darwin arm64, August27,2026 08:03:23.904 UTC.

## Why the old expectation no longer governs

The historical session close awaited pending results without cancelling their
queue admissions. With maxWorkers1 and an idle worker's termination gated, it
therefore admitted the queued session's replacement after the gate opened.
The historical assertion was meaningful for that older close implementation;
it is not an oracle defect and its failure must remain recorded.

The approved contract registers before resource-capable work, permanently closes
owner acquisition admission, releases invocation-owned requests/leases, and
forbids late reopening after cleanup. Current local executor documentation
explicitly specifies cancellation of owned queued/active requests. Its callback
uses session.close as that ownership boundary. Successful completion of an
unstarted queued request after close is therefore not a promised invariant.
The contract does not prescribe one universal cancellation algorithm for every
resource owner; this adjudication does not infer obsolescence merely from changed
implementation. It checks the documented close policy against normative ownership
and verifies that cancellation preserves the remaining cleanup obligations.

## Observed controls and exact outcomes

| Independent named group | Result |
| --- | --- |
| Retained idle/queued ordering with duplicate messageerror | CLOSED; one worker; no replacement; close waits for gate |
| Positive queue with session left open | One worker before gate; second after gate; exact ranges |
| Queued close with active sibling | CLOSED; sibling not terminated or awaited; sibling reusable |
| Prior caller abort, two variants | Exact reason identity: Error with code CLOSED and falsy0 |
| Selected PROTOCOL, with/without later caller abort | Internal PROTOCOL; outer caller identity or same selected error |
| Synchronous registered cleanup before acquisition | CLOSED; zero executor.open calls and zero workers |

**6/6 named groups, 8/8 fixture variants**, not eight public scenarios. Eight fake
transports terminate exactly once; all four transport event listeners and observed
caller/combined request-signal abort listeners are removed. The prior-abort test's
title says errno-shaped, but its object actually has execution code CLOSED;
the later-abort object has errno code EACCES. Both shapes are checked by identity,
not code classification. No separate error-object identity is invented between
independent closed-run calls, which construct separate errors.

Queued request settlement and close settlement are separate. The queued request
rejects before the idle retirement gate; the final handle's close remains pending
until termination finishes. Duplicate close returns the same promise. Late run
throws CLOSED both before and after retirement. The first handle's close does not
wait for final idle cleanup; a closing queued owner with a live sibling does not
wait for global worker zero. Duplicate messageerror does not duplicate terminate.

Once the internal request chooses PROTOCOL and enters retirement, a later caller
abort does not rewrite that selected request rejection. The enclosing
withRegexSession instead applies exact caller-abort precedence before its own
settlement. Without abort it preserves the selected execution error object.
These are direct internal/helper checks, not public Shell precedence acceptance.
Direct run returns matches or rejects; it has no command exitCode. Neither a
successful executor call nor CLOSED proves grep/rg status2, pipeline status,
stderr, or runtime cancellation behavior. No exit-status assertion was relaxed.

## Required scope of a separate test-only proposal

The following criteria were recorded before handoff; `POST-HANDOFF.md` records
their subsequent application to the precise announced delta. In the
retained test, replacing the after-release worker-count assertion2 with1 must
also remove the nonexistent worker2 reply/success expectation and explicitly
assert the queued rejection is RegexExecutionError/CLOSED. Keep the pre-release
worker count1, close-not-complete assertion, duplicate messageerror, single
termination, awaited close and exact listener cleanup. Add or identify a separate
unclosed-session positive progress control and an active-sibling preservation
control; removing the only post-retirement queue-progress check is insufficient.
No canonical file is edited here. This describes review criteria, not concurrence
with an unavailable patch or authority to relabel historical99/100 as100/100.

## Commands, cleanup and limits

```sh
node --unhandled-rejections=strict tests/stress/regex-execution/queued-close-adjudication/review/run.mjs
git diff --check -- tests/stress/regex-execution/queued-close-adjudication/review
git diff --exit-code 01aa1bffe0568cc6787d5ff8e0331e024a787385 -- src/commands/regex-execution/client.ts src/commands/regex-execution/protocol.ts tests/commands/regex-execution/followup/messageerror.test.ts
```

The exact probe child38621 exits0 with no signal, stdout/stderr closed, no IPC
connection, no8-second watchdog/safety kill, and zero native workers created.
No owned child remains. The bounded readiness-wait process also exits normally.
All changes are confined to owned review files plus the explicitly requested
/tmp marker. Unrelated live/staged work is not modified or committed.

Historical **99/100**, **originalfive0/5**, and **110/111** remain preserved;
none was rerun, rewritten or converted to a pass. No risky exposure, originalfive
rerun, broad suite or claim of full acceptance, superiority or duration.
Runtime still awaits a USER/root-relayed immutable Sagan commit. Concurrent
livegit changes do not supply that authorization.

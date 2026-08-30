# Separate review of the announced test-only delta

## Decision

**Agree with adjudicator `6dbd7d06f9c1901602b415773bb33ba1522a1c6e`: the old
second-worker expectation is obsolete; no source regression is demonstrated.**
The precise proposal is suitable for the canonical owner to apply and validate
as a test-only migration. No blocking disagreement. This review does not apply
it, change source, rerun canonical tests, or claim the literal proposal passed.

Independent expectations were frozen in `7151577` before findings and before
the six independent fake-transport groups. The ready note arrived during commit
of the bounded pending checkpoint `a2c9949`, after a60-second wait. Only then did
this reviewer read the adjudicator's report, proposal, all controls, runners and
retained targeted evidence. No further test execution was needed or performed.

## Exact reviewed objects

All below are frozen by the adjudicator commit; live copies were compared against
that commit with `git diff --exit-code` before review completion.

| Path under queued-close-adjudication | SHA256 |
| --- | --- |
| PROPOSED-TEST-DELTA.md | `ff5d5e3e639b3f5f375920ec85168ce8dbeca7d9000da48a3b531a613aa4962a` |
| REPORT.md | `5b71f4856f5fd54349c280783705f1e9085559a40e1c5ea085cb6e6ec55e5a46` |
| controls.test.ts | `8703a61da44228731ffaf09f0f0fef5373d507458dd4d3dcb098460b704c9cda` |

Source is unchanged `01aa1bffe0568cc6787d5ff8e0331e024a787385`, client SHA256
`1638d492d11d466875b98451a59bace4e60e71fcd5468d671182187549922bca`.
The adjudicator's current freeze references the concurrent expectation commit
`7151577`; relevant bytes match the supplied source. It is not runtime authority.
Its before source parent `19669450a3acf869b8885b091db59e0a6e9cb65f` has the same
client hash as the independently inspected approved-contract baseline. Every
recorded profile matches its revision; canonical hashes are identical across all.

## Critical review of the proposal

- The replacement block is precisely delimited inside the one idle test. It
  removes only the obsolete replacement-worker reply/success path, retaining
  duplicate-messageerror setup, pre-release capacity1, pending close, final clean
  and finally cleanup. No startup/active/precedence/native assertion is relaxed.
- It now requires CLOSED rejection as an Error named RegexExecutionError, with
  exact current message. It does not falsely attribute the idle PROTOCOL event
  to the later queued invocation. Before and after retirement it rejects late
  run; repeated close shares the same original completion promise.
- It explicitly requires not-terminated before gate release, close completion
  afterward, one worker total and only the original worker's one posted request.
  The retained clean helper checks exactly one terminate and all four worker
  listeners absent, not merely the eventual worker count.
- The new companion leaves the queued session OPEN. It requires one worker
  while retirement is blocked, then a second only after the first terminates,
  followed by exact match ranges. Its canonical fixture has a single shared
  termination gate, already released before second.close, so that final close
  does not deadlock. The separate owned controls use per-worker gates correctly.
- Active sibling preservation is not inserted into the canonical proposal, but
  it is explicitly checked by the adjudicator's third control and independently
  by this review. This meets the scoped ownership safeguard without making the
  canonical migration larger. It is not other-Shell/public concurrency proof.
- The original failure and exact input hash remain preserved. A migrated future
  test would change a cohort; it cannot retroactively turn99/100 into100/100.

The exact error-message assertions are stricter internal-source snapshots, not a
new public contract guarantee: the normative closed-admission Error message is
not contractual. That does not block this fixed-source test-only proposal.
Two queued requests of the same owner sharing the close-error object is checked
by the adjudicator's first control. Independent late run calls may create new
Errors; no cross-call identity requirement is inferred from equal CLOSED codes.

## Error/status and controls adequacy

The source review and independent6/6 groups establish the distinctions relevant
to this migration: duplicate idle error cleanup, gated final close, closed versus
open queued progress, rejection of late acquisition and sibling isolation.
The adjudicator's11/11 controls add startup/active PROTOCOL, same-owner error
identity and prior ENOENT-shaped Error/false/0/empty-string/null reasons.
These overlap with independent controls and must not be summed as17 distinct
behaviors. They are adequately targeted for the obsolete-expectation question,
not exhaustive lifecycle or full public acceptance evidence.

The adjudicator correctly keeps already-selected internal PROTOCOL distinct from
a later caller abort. This review additionally exercises withRegexSession: the
inner selected PROTOCOL stays unchanged while the outer caller reason wins by
identity; absent abort, outer rejection is that same selected Error object.
Neither direct rejection, node:test child exit1, nor fake terminate result1 is a
grep/rg/Shell exit status. No status or diagnostic relaxation is proposed.

The adjudicator's clean helper checks caller-signal and worker-event listeners,
not the combined request signal. Its report accurately limits this to tracked
worker/caller listeners; this review also checks the internal combined signal.
No assertion here implies every possible host listener or future interleaving
has been covered. Normal gated retirement succeeds; arbitrary termination
failure, public dispatch-tree drain and uncooperative host work are not retested.

## Evidence read, not rerun

| Frozen adjudicator evidence | Verified contents |
| --- | --- |
| before-canonical.json | Exact old test1/1; child37629 exit0 |
| registration-canonical.json | Exact old test0/1; line123,1 !== 2; child37631 exit1 |
| current-canonical.json | Same0/1 assertion; child37633 exit1 |
| current-controls.json | 11/11;11 fake workers exactly retired; child37635 exit0 |
| types.json | Scoped NodeNext typecheck pass; child40007 exit0 |
| finish.json | Relevant/history bytes unchanged; index unchanged; exact temp removed |

All five adjudicator child PIDs are recorded absent after normal completion;
the four async probe children record both stdio closures and no safety kill.
The tsc child is synchronously reaped. Strict rejection settings and anchored
single canonical-test selection are visible in the recorded commands. Native
test bodies are not selected. No attempt was made to rerun or overwrite its
exclusive-create evidence or touch the adjudicator's files.

Independent evidence remains6/6 groups,8 variants,8 fake workers, zero native
workers or remaining observed listeners; exact child38621 exited0 with both
stdio streams closed, no signal/IPC/safety kill. No owned children remain.

Preserve historical99/100, originalfive0/5 and110/111. No new exposures, risky
probes, full suite, public/default/runtime acceptance or source/canonical changes.
Runtime still requires the explicit USER/root-relayed frozen Sagan commit.

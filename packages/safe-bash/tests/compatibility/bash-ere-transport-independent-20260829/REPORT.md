# Independent ERE transport SOURCE review — HOLD

2026-08-29. **Repair before actual Worker qualification.** Four source blockers
and two lifecycle qualifications are recorded below. These are source-derived
branch/contract findings, not reproduced runtime failures. No production validator,
engine, compiler, Worker, package consumer or native test was executed.

## Exact subject and preserved history

- Initial transport: `65f0e08078a186d322b7ab975bac5972f09bef17`.
- Successor: `0f36459ccf38623906c5c80702c5d32111167f4d`; the only production
  change after the first commit is owner.ts stdout/stderr:true and four handlers.
- Handoff: `6c68be44446ad6f3251697f1be6a07910155c53f`; retained authentication
  publication: `7cdb62ac008899dcb692b4bed15485d81215b227`.
- Exact final SEAL-v2 SHA-256:
  `f6ff74e59b15c98e230a2011af8c5c21d6922e44599bc88084a3705846cc55d1`.
- Unit3 baseline is `7a5c620005fb04518d44bb284f4e99284e4a7c33`; five unchanged
  engine inputs are `b5f2464f63172fc7c92bcfd33fbb2a8a6d8c03eb`. Only R02 has
  ROOT checkpoint acceptance. R01/native12/full engine acceptance remain held;
  this review does not assess matching or repeated-capture selection.
- Compared with immutable design0a7840d1, choices56fb1136 and ROOTaa16808c.
  Original **32 families / 60 runtime variants remain UNRUN**. The ten prioritized
  schedules here are post-source mappings/supplements, not new precode claims or
  ten additional executed tests. GNU functional proposal1cfd0f02 remains HOLD.

The named changesets add seven private files and modify only owner.ts afterward.
They do not edit legacy expr/regex unions, public RegexExecutionOptions, root
exports, package files or runtime. This is selected-source/write-set evidence,
not reconstruction of a whole current package or a legacy runtime regression.

## Blocking findings

### ERT-S01 — cancellation does not implement frozen L03/L04

`root.ts:81` checks an already-aborted signal, but no abort listener exists.
A queued abort(false) retains its ticket and storage until eventual pumping or
close/failure, contrary to L03's removal boundary. For active abort(0), a valid
reply arriving before timeout takes `root.ts:138–141`: validate/commit, then
throw raw0. With reconciled=true and no root failure, `root.ts:150–160` never
closes the Worker. execute rejects before Worker retirement; a subsequent session
close sees no active job. This contradicts L04 even without claiming universal
immediate preemption. The author's bounded-drain qualification does not amend
the independent freeze.

Add owned cancellation enrollment/removal, initial/recheck race handling and
active retirement/settlement. Preserve queued siblings, actual reason identity,
validated usage once, and conservative unknown consumption.

### ERT-S02 — admitted arrays still invoke inherited code

`validation.ts:24–39` checks own index/length data, but :71/:108 iterate with
for-of and :92/:165 call borrowed .map. An array with a custom prototype can
pass the own-data checks yet execute an inherited iterator getter/function or
map override. Returning the original array from map also causes copyInput to
freeze caller-owned data and retain mutable fragment aliases.

Use bounded admitted own-index data traversal/copy without borrowed hooks.
Do not replace this with a cross-realm prototype-identity restriction. Required
controls must observe zero hook calls and preserve caller ownership/snapshots
(P05/B06). No malicious object was executed in this review.

### ERT-S03 — owner close does not join start/request waiters

`owner.ts:95–110` joins termination and exit only. Close before READY clears the
startup timer; the exit handler at :51–54 suppresses failure when closing. No
path settles the pending ready promise, so start can remain pending after close.
Close during a request likewise does not join/reject the request waiter; its
timer can reject it after close has returned.

Current Root.close waits active.done first (:190–192), avoiding that owner
overlap on its ordinary route by waiting for startup/request settlement. It does
not make the private exported owner's close contract correct, and promptly
closing on the S01 repair would expose the startup problem. Settle and join all
admitted waiters/timers together with retirement, with explicit reason selection.

### ERT-S04 — payload arithmetic is not a complete parent ledger census

The schema-only arithmetic agrees: U(request)=47+4n+p+s, success reply<=170,
result<=139, failure<=62, hence reservation479. That is not enough to qualify T/H.

Root initialization charges metadata(18), or **24 units including its token**
(`root.ts:42–46`, `accounting.ts:103–117`). Under the ratified metadata-cell
rule, a source census is root fields/container16, EngineAccounting5,
TransportAccounting7, bounds3, limits8, spent-counter record8, queue/map
containers2, reservation token5: **54 logical units**, not heap bytes. Excluding
Map internals and native Promise/VM frames does not exclude these owned records.
Several are constructed before metadata admission.

Own-key arrays/descriptors in validation, inspection/validation result records,
queue cells and usage snapshots also lack a complete documented charge/retire
mapping. Reflect.ownKeys allocates all keys before rejecting excess cardinality;
that is not the already-disclosed native structured-clone exception. Supply and
independently validate a complete census/precharge/retirement plan, or seek an
explicit ROOT exclusion amendment. Do not silently narrow T to payloads.

## Additional lifecycle qualifications

- **ERT-Q01:** stdout/stderr:true prevents default forwarding, but :58–61 adds
  only data/error callbacks, and close has no explicit stream end/close join.
  Idle fatal output/unsolicited messages call root.fail without scheduling
  retirement. Require a pinned Node lifetime proof or an explicit owned stream/
  fatal-retirement barrier and controls. This is not an observed stream leak.
- **ERT-Q02:** `root.ts:157` can cache a cleanup rejection directly as #closing;
  later close bypasses its normal barrier. Exercise concurrent active.done/root
  close, termination rejection including undefined, known versus unknown exit,
  and independent cleanup/quarantine. Retained metadata after a cleanup failure
  is not by itself a demonstrated native leak; no such runtime claim is made.

## Source features aligned with the design

The sibling static entry, one root-owned serialized queue (64 waiting plus one
active), early registration before Worker acquisition, same-local-ledger adapter,
seven-counter envelope and aliases, nonmatch groupCount+1 nulls and explicit
empty spans are present. Validation checks ordinary own descriptors, falsy whole
frames, proxy rejection, safe integers, IDs, cardinality, capture sums and
over-grant/alias contradictions. Engine accounting retains high-water inputs,
cumulative spent counters and poisons unknown sent grants without refund.
postMessage's posted marker is set before the call, conservatively consuming a
possibly unsent clone-failure grant rather than minting credit. These are source
observations, not runtime passes or complete lifecycle/accounting qualification.

## Type/evidence and next gate

Authenticated 12 selected source bodies, both retained 24-emission cohorts and
two consumer fixtures. Retained receipts show two strict source builds, two
positive consumers and two negative consumers; each negative has exactly
TS2353(2:108), TS2322(3:59), TS2345(5:47), 342 diagnostic bytes. Six historical
compiler children are recorded closed. No compiler ran here. The negatives
exercise new transport types, not a fresh old-Expr-union consumer test.

Old64 administrative compliance remains NOT CERTIFIED. ROOT's later12-Git-child
publication history is preserved; selected stored publication snapshots record
4 authentication / 8 final-stage children, not a new total-census certification.
No historical result was changed or rescored.

Recommend source repairs plus focused source/synthetic review before any actual
Worker GO. LOADER.md identifies why the compiler-only harness is not an admitted
Worker harness. PRIORITY-CONTROLS.json maps the bounded next controls, all UNRUN.
No transport, engine, public-runtime or native-parity acceptance follows.

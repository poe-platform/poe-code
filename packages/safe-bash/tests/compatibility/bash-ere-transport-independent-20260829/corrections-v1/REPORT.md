# Private ERE transport corrections: independent SOURCE/pure review

2026-08-29. **SOURCE_HOLD for S-C01 accounting coverage; pure controls pass.**
No transport/Shell/Worker activation or comparison GO. No author/production edits.

## Exact subject and execution

- Transport `02782056c436c9f2a8319f73a9eb8e2b4b5aebd5` and evidence
  `6c884cc630a6ef1b93b247428e635596ede4b7aa`.
- Packet `989faf94e2d292800aa485183a215410e7cfa000`, REVIEW-PACKET-v2.md.
- Tested retained engine is **b5f2464f63172fc7c92bcfd33fbb2a8a6d8c03eb**.
- Independent preseal SHA256
  `a1242b76288e09d82ede0ef41d653a720ce6484f944ae9801f8d471446045109`,
  committed before any pure control import.

`prepare.mjs` authenticates seven source files against exact stored Git blobs.
Packet binding metadata and archive wrapper are also authenticated by stored blob
identity. Compressed102944 bytes SHA
81de06b72e96be4c05e487dabd774fa97afb65d4029200d0e1260938c32c1c08
are admitted before inflation with exact504295-byte maximum; raw SHA
2259d83e1c8c8bfcf4ed2a845a3f61dcba4bc2b3a9debd3f2523253226f73f41
is checked before parsing that same buffer. The69-member archive is metadata/data,
not execution authority. Exactly five admitted RUN-v3/work/emitted JS files are
materialized: accounting, validation, protocol, errors and limits. Owner/root,
Worker entry, wire-engine, syntax and matcher are not materialized or imported.

**12/12 unchanged author pure controls +12/12 independent controls pass.**
Original pure-controls.mjs.data is copied byte-exact; only its physical output
namespace and manifest inputs relocate. Its own hash/loaded-source verifier
observes five modules; an outer allowlist independently checks the same loaded
bytes and denies other imports. Seven total loaded files include the two owned
control modules, not seven product assets. No compiler, type runner, Worker,
matching engine, Shell, native oracle, network or private repository execution.

The captured child PID24538 exited0/closed0,114stdout bytes/0stderr observed and
retained; preflight/postflight true, no errors or signals. One capture owner and
one pure dispatch, peak2, no test-created descendants. Both tool roles completed.
This is not a universal process census. Author's37 correction children, two strict
builds and type results remain a separate historical cohort, not rerun credit.

## S-C01 — remaining explicit-work coverage blocker

Concrete source routes in the pinned seven-file transport:

1. `worker-entry.ts` invokes record for workerData and each incoming message with
   `() => {}` visitors. Those validations perform explicit JS checks/traversals.
2. `validation.ts:validateRequest` uses a private work counter capped50000000,
   independent of the request allowance and cumulative parent TransportAccounting.
   `wire-engine.ts` calls it **before** constructing EreLedger. No returned request
   validation usage is committed to either ledger.
3. `wire-engine.ts` takes ledger.usage to construct the reply, then calls
   `validateReply(reply, request, () => {})`. Its explicit visits do not change the
   published usage. N07 measures **39 visits** for the minimal canonical nonmatch
   frame while usage.work remains0; a supplied limit38 visitor refuses. N06 also
   confirms pure validateRequest accepts an allowance.work0 frame. Neither test
   invokes executeWireRequest or a Worker.
4. Parent `root.ts:#execute` does precharge requestUnits U and later charges parent
   reply validation/result copying, while reserving479 storage units. That source
   must not be ignored. U can plausibly prepay portions of request-side traversal;
   however the packet/UNITS does not establish an exact mapping covering all three
   Worker sites, their repeated work, or how that work stays within the claimed
   cumulative counters. Storage reservation479 by itself is not a work debit.

**This establishes a missing coverage proof, not a measured39-unit runtime overrun
or a proof that every existing prepaid envelope is insufficient.** The amended
policy explicitly excludes only named native/intrinsic overhead, not explicit
Worker JS work; it expressly requires this coverage audit. Therefore a source
acceptance cannot silently assign unspent metadata or request slack to a new work
role. Before acceptance, author must either provide a precise source-derived
existing prepaid mapping with bounded counterproof, or obtain ROOT approval for
a code/ledger correction and different review. No source edit is made here.

Native own-key enumeration and clone/transient exposure are prospectively accepted
only under PRIVATE-ERE-LOGICAL-ENUM-1. That resolves the policy choice, not this
explicit-work obligation. Original S04/2e9deaab is unchanged, not reclassified green.

## Corrective source assessment, not Worker proof

**Queued cancellation.** root.ts retains ticket cancel state/reason and a done
promise. It enrolls the queue ticket before attaching its abort listener, then
checks abort again. Queued cancel removes that ticket, removes its listener,
releases unused reservation, retires owned copies/metadata, finishes and rejects.
Session close filters only its queued tickets. Already-aborted submission precedes
input work. Pure N04 verifies0/null/native abort(undefined) reason identity and
unchanged validation usage; it does not exercise the queue.

**Active cancellation/retirement.** The active ticket preserves caller reason;
retirement sets a generic CLOSED root failure rather than distributing the active
caller's raw reason to siblings. Root/session close joins active.done and owned
retirement. The root is poisoned when its shared Worker becomes unusable; this is
not a claim that other queued sessions continue after active Worker cancellation.
Unknown sent grants consume remaining allowance and poison engine accounting;
storage is not refunded while retirement remains unproved. Actual overlapping
abort/READY/message/close races, listener counts and resource settlement remain
among the60 UNRUN variants.

**Direct waiter joins/falsy precedence.** owner.ts keeps direct ready/request
promises, rejects them in #settle, and close joins termination, exit, stdout/stderr
retirement plus both waiters. Presence booleans distinguish false/undefined failure
from absence. Late rejected promises have observing catches. Stream listeners and
exact native retirement behavior were inspected only as source, not certified by
importing the owner. Cleanup rejections and caller precedence still need runtime
fixtures with actual owned handles, not invented unhandled-rejection credit.

**Snapshots/schema.** Pure tests cover exact own-key order; symbols/nonenumerable
extras; holes and inherited numeric/iterator/map getters; Proxy refusal without
traps; own-index reads; fresh frozen fragments/spans; aliased incoming captures
copied to distinct owned spans; caller mutation only after copying. Native lists
may allocate before rejection under the amendment. No hostile-Proxy bound or RSS
claim. Private input inspection/copy occur synchronously; tests do not invent an
arbitrary concurrent mutable-host-buffer contract.

**Parent accounting.** Existing metadata tables root61/session5/ticket34/worker68/
usage16 plus token5 remain unchanged, not removed under the exception. Bootstrap
checks precede explicit root-owned containers; queue metadata precedes ownership;
copy reservations2U and reply/delivery/result479 retain their roles. Pure tests
exercise boundary failures, spent/reserved/live separation, idempotent retirement,
unsent versus unknown-sent grants and no cumulative refunds. N08 verifies nominal
table values and cap behavior, **not** a dynamic census of owner allocations.
Native overhead exceptions cannot be broadened to waive arrays, Maps, owned copies,
listeners or explicit JS work. A full allocation/lifecycle census remains tied to
source-derived roles and future runtime evidence; passing pure tests does not
settle S-C01.

## Novel control record

N01 own keys/order/symbol/hidden; N02 aliased capture snapshot; N03 inherited array
cell refusal without getter; N04 falsy/native abort identity/no work; N05 caller
mutation after copy; N06 separate zero-engine-work request validation; N07 exact
39 reply visits/limit38 refusal; N08 metadata/cap ordering; N09 spent/live lifecycle;
N10 conservative grant abandonment; N11 finite extra keys/zero Proxy traps under
the amendment; N12 bootstrap storage/work ceilings. `RESULT.json` keeps every row.

## Eventual60-variant prerequisites

1. Close S-C01 by exact prepaid accounting proof or approved source correction.
2. ROOT now accepts finite pure engine72187e5abc1179883f85a63e1ef558f2e141c542 based
   on independent d81a5a66cccf650d72538dad522b6fc310e82a04. This does **not** rebind
   this packet: author must rebuild/reauthenticate transport with R01, complete
   declarations and the actual static import graph. Current b5 matcher.js must
   never be reported as R01 output. No engine validation was duplicated here.
3. Preserve all32 families/60 variant IDs, original roles and expectations as UNRUN.
   Freeze source-built/installed/moved package and consumer identities, entry asset,
   read roots, exact tools and per-importer builtin authority. Current retained
   proposal has12JS/12declarations, parent7/Worker9/union11 plus empty types.js;
   this is static packet metadata, not an actual Worker load receipt.
4. Proposed edges remain limits.js→node:timers/promises, owner.js→node:worker_threads,
   validation.js→node:util, worker-entry.js→node:worker_threads, each bound to its
   new importer hash. Do not grant a builtin globally. Adjacent worker-entry URL
   alone is not physical child-load proof. No Expr fallback or live-dist substitution.
5. Freeze exact loader/permission/physical-root recipe and any instrumentation
   separately. execArgv[]/empty env cannot be assumed to inherit parent loader or
   permission settings. Retain workerData operation/version, stdout/stderr ownership,
   128MiB-old-generation/4MiB-stack profile, private3000/1000ms timers and64 waiting
   tickets without claiming hard RSS/deadline guarantees.
6. Fresh ROOT runtime GO must bound processes/threads/capture/work, enroll before
   acquisition and retain raw startup failure before admission; require exact
   retirement, stream/waiter cleanup, no implicit retries and clear UNKNOWN tails.

## Preservation and publication

All60 remain UNRUN. Original7files65f0e080/0f36459c, review2e9deaab, S04,
historical original64 administrative compliance NOT CERTIFIED, correction37/37,
old12 pure and type evidence stay separate. Comparison/P2/XAN remain paused.

One source-only helper refused reading PRESEAL-v3.json under its65536-byte text
admission cap; no larger read or control retry followed. Needed Node binding was
independently stream-hashed instead. That ordinary DATA-helper refusal is not a
product finding. Display-truncated source excerpts are not claimed as complete raw
captures; actual control stdout/stderr/results are retained. No instruction text,
binary dump, private source or old archive modification. `PUBLICATION.json` records
final source/tool guards, receipt SHA and bounded role/capture accounting; final
Git completion is reported only after its tool returns. Owned scope is isolated.

# SC01: SOURCE ACCEPT, pure-only qualification

Date: 2026-08-29. No transport activation is authorized by this report.

Candidate: `46611a5b67ad7af276154421ac7f50dd536ec570`.
Author evidence: `bd3a0422b10c8fc4d79ed0c69dda6fb2f28df5c3`.
Engine source: `72187e5abc1179883f85a63e1ef558f2e141c542`.
Combined twelve-source manifest:
`e785668f13549aba24323a6db568fb58805eca41a190ce18b41c299c28a53a5f`.
Independent preseal: `fa6e16fe9dc4beb5bd93d0e6c448e3ca8b9a3d0b5023d5d3b623883902b2b807`.
Independent receipt: `6049daf89f7ab5390d1834a038cee2fa2e3918feeb25e5d6c650a1487a8fd72e` (`RECEIPT.json`).

## What actually ran

- Unchanged author P01–P12/SC13–SC20: **20/20** on the new authenticated pure assets.
- Independent N01–N12: **12/12**. These include 15 request combinations,
  594 result-span/participation combinations, nine failure combinations and six
  malformed-frame checks. Subchecks are not additional Worker variants.
- One pure child, PID64713: exit0 and close0, no signal; 76 stdout bytes,
  zero stderr bytes retained. `RUN.json`, `child.stdout`, `child.stderr`,
  `PURE-RESULT.json` and `NOVEL-RESULT.json` are the actual records.
- The load hook authenticated the unchanged author fixture plus **five** pure
  modules: accounting, validation, protocol, limits and errors. No owner, root,
  wire-engine, Worker entry, syntax or matcher was imported. No compiler ran.
- 24 sealed local postguards and twelve current source postguards passed.
  Emitted-JS provenance is the authenticated author build archive, not a new
  independent compile. The accepted engine's matching tests were not repeated.

The registered parent/child execution peak was two. The direct administrative
launch ledger uses a conservative publication ceiling of 40 known OS roles,
including waiting shells, Git and patch-tool roles; this is not a global kernel
census. Each completed tool invocation returned; the sole validation child has
explicit exit/close observations. No validation child or timer remains active.
Preparation and validation have separate raw files. Initial interactive source
displays/schema-inspector failure are disclosed in PLAN.md, not reconstructed
or promoted to qualification evidence.

## Derivation, not merely empirical fit

For n fragments, p ASCII pattern bytes and s ASCII subject bytes, request units
are Q=47+4n+p+s. `validation.ts:133` now accounts for:

| Explicit logical work | Units |
| --- | ---: |
| Request record/header keys | 10 |
| Bounds record | 3 |
| Allowance record and resource-validation loop | 8+7 |
| Array header/index-descriptor traversal | 1+n |
| Fragment outer loop and two-key fragment records | n+3n |
| Pattern/subject ASCII traversal | p+s |
| Total | 29+5n+p+s |

The fixed prefix before the allowance is established is28. Subsequent visits
check the same remaining W before proceeding. Malformed records reject before
unbounded explicit traversal; native own-key enumeration retains the ROOT's
narrow amended exception, not a hostile-Proxy or hard-memory guarantee.

`worker-entry.ts` accounts for startup3 once and header10 each request.
`wire-engine.ts` charges request visits + entry work + reply210 to the same
EreLedger **before compile/match**. The root reserves a grant and checks
Q+205+n = 13+(29+5n+p+s)+210 before constructing/acquiring a Worker owner.
Subsequent successful requests debit three fewer startup units; root admission
remains conservatively at the first-request bound. This is explicit entitlement,
not a claim that the validator actually executed210 visits on every result.

For replies, the existing result visitor is38+N+3M. The additional explicit
seven-resource validation loop and N span-loop iterations give
45+2N+3M. Shape checks bound N≤33 and M≤N before iteration; therefore the
maximum is210, attained at N=M=33. Record descriptors, array indices and span
fields are bounded by those shapes. Failure replies have only the finite
syntax/unsupported/profile-limit categories and seven allowed resources;
the declared visitor plus resource loop is at most69. Invalid kind, keys,
usage, counts, spans or diagnostic fields stop on a prefix of these bounded
paths rather than accepting arbitrary diagnostic text. This is the ratified
logical-node accounting model, not every VM instruction or native allocation.

The210 allowance is never refunded after a small reply. The pure tests verify
259 then256 debits, cumulative515, and retained input high-water3/5. The root's
unobserved abandonment remains non-consuming; possible startup/post observation
with unproved usage consumes the remaining cumulative grant and poisons reuse.
Malformed/raw failure is not turned into a successful semantic result.
False/0/null/undefined observer reasons remain exact identities in independent
tests. Caller cancellation and actual Worker retirement remain SOURCE-only here.

## Integration and lifecycle assessment

`SOURCE-DELTA.diff` authenticates the exact old02782056→new46611a5b change.
Only accounting, root, validation, wire-engine and entry differ. Owner/protocol
are unchanged; no wire/session/root public signature change appears in the diff.
`validateRequest` gains optional prepaid/observer arguments; `executeWireRequest`
gains an optional entry argument. Existing single-argument callers remain
source-compatible. The new root helper call and entry forwarding match their
private signatures; no new public API is required. This is SOURCE inspection,
not an independent TypeScript-consumer pass. Author positive/five-negative
consumer results remain author evidence.

Queued cancellation removes the ticket/listener/reservations and does not
acquire a Worker. Active cancellation joins retirement before completion; failure
presence and ticket cancellation use explicit flags rather than reason truthiness.
Owner.close snapshots and joins ready/request waiters, termination, exit and
stdout/stderr; root/session closes join active.done/retirement. Source snapshots
and descriptor-index access avoid inherited iterators and caller mutation.
Parent copy/record/result ownership remains separately charged by T/H, including
2Q request and479 reply reservation; native exceptions do not waive owned
copies, arrays/maps, listeners or explicit loops. No new lifecycle blocker was
identified in the SC01 delta, but these are not actual Worker observations.

Root integration `e013f817f` is still bound to the prior transport composition.
It must be explicitly rebound/compiled against this candidate before any
integration acceptance. The new author twelve-module compile does not certify
that separate root-integration consumer automatically.

## Exact future closure and authority gates

Source-proposed parent assets: errors, limits, transport/{accounting,owner,
protocol,root,validation}.js. Worker assets: errors, limits, matcher, syntax,
transport/{accounting,protocol,validation,wire-engine,worker-entry}.js.
Union: eleven runtime JS members; types.js is an empty/declaration-only emit.
Five pure JS hashes actually loaded are in PURE-LOADS.json. Full future JS and
declaration bindings must use the author EMITTED.json/COMBINED-12.json together,
then authenticate the physically staged/moved files before any runtime import.

Exact builtin edges: limits→node:timers/promises;
owner→node:worker_threads; validation→node:util;
worker-entry→node:worker_threads. None imply network/filesystem/native-oracle
authority for product matching. The review harness itself has separate trusted
file/capture/hash/loader capabilities, not a product capability grant.

Proposed fixed Worker launch remains adjacent static worker-entry.js,
workerData `{operation:'shell-ere',version:1}`, env `{}`, execArgv `[]`, captured
stdout/stderr, 128MiB old-generation/4MiB stack settings, startup3000ms,
request1000ms and64 queued tickets. One active Worker per root, no retry. These
settings are not RSS bounds or inherited loader/permission authority.

Before a fresh ROOT runtime GO the author must seal:

1. The actual parent/Worker loader, entry, physical paths, modes, complete
   eleven-JS closure and root-integration rebind to721+466. Parent hooks are not
   inherited proof under execArgv:[]; actual child imports need receipts.
2. All32/60 existing variants, concrete per-variant root/Worker/thread counts and
   a finite **aggregate** Worker/OS-process budget. This packet fixes one Worker
   per root but supplies no justified aggregate count for60 variants; do not
   infer60 Worker starts, silently replenish, or manufacture a global cap.
3. No-acquisition low-W/pre-abort and queued controls; active abort/falsy primary,
   startup/request/close overlap, streams, failure/crash and unknown-usage poison;
   same-W prepayment and conservative210 behavior using real Workers.
4. Source/moved missing/tampered assets, malformed frames and loader/builtin
   refusals; capture-before-admission, exact cleanup and fail-closed resource
   accounting, plus independent type/load proof for the selected composition.

All **32 families /60 Worker variants remain UNRUN**. Prior S-C01 HOLD and S04
historical native-enumeration/preallocation evidence remain unchanged; the ROOT
policy amendment is not retroactive success. No Shell/transport activation,
comparison, native parity, compiler rerun, security/RSS or universal-preemption
claim follows from this SOURCE ACCEPT.

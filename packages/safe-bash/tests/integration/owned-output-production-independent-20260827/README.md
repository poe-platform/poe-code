# Owned-output production: independent preparation freeze

2026-08-27. **PREPARATION ONLY: 0/36 candidate cases executed. No production
acceptance, promotion, public integration or whole-gate activation.**

This is a different review of the prospective production rebase, not a restatement
of the accepted temporary 25-profile actual-SafeJS replay. Root assigned only this
new test/evidence directory. No author source, AGENTS, root barrel/package, old
fixture, or private checkout is modified. No private checkout has been read during
this preparation; no product, copied engine, service, compiler or package ran.

## Chronology and exact boundaries

- Initial committed observation: `a03b9288a6f4b652387be9fefa8faf17ef58b9e7`.
  At that baseline `src/contracts/output.ts` is absent and ByteSink has no
  ownedOutput capability. `BASELINE.json` binds Git blobs, not a live overlay.
- The historical source proposal `7adabe6b` and independent TEMP replay
  `9f15ac3f` were read before designing these cases. The review is therefore
  **post-prototype/source-proposal**, not blind to the historical design.
- Cases were written before receiving any production-candidate/API handoff.
  During preparation, author changes appeared in eight existing paths; their
  diff was not opened, imported, copied or used to tune expectations. The new
  helper's live presence/content was not inspected. This is a pre-handoff
  semantic freeze, **not proof it predates every author edit**.
- No current candidate was selected, built or accepted. Future binding/driver
  work must disclose its later chronology separately. Cases freeze required
  semantics, not an already implemented executable 36-case product driver.

## Nine-path author scope, not the old six-path delta

1. `src/contracts/io.ts`
2. `src/contracts/output.ts` (new)
3. `src/contracts/index.ts`
4. `src/shell/runtime.ts`
5. `src/shell/shell.ts`
6. `src/commands/network/types.ts`
7. `src/commands/network/transport.ts`
8. `src/commands/network/curl.ts`
9. `src/commands/streams.ts` (**cat section only**)

All nine remain author-owned. No shared.ts/input.ts changes are authorized;
existing zero caps, byte-retention/sort/tail/other-command changes must survive.
Candidate review will inspect exact author commit deltas against their declared
parents and distinguish unrelated already-committed product changes. Unexpected
new paths/hunks are reported to root, not silently included or overwritten.

## Proposed API to bind, not a speculative implementation

From the inspected declaration history/proposal:

```text
ByteSink.ownedOutput?: {
  consumerClosed: AbortSignal;
  write(chunk: Uint8Array): Promise<void>;
}
createOutputOperation(context, destination) -> operation
operation: signal, output, registerCleanup, acquire(start, release),
           child(destination), close()
HttpRequest.registerCleanup?: cooperative cleanup registration
```

The accounted method is `ownedOutput.write`, **not** an `accountedWrite` field.
The expected context needs signal and optional invocation cleanup registration.
Exact exported type names/generic signatures and runtime error shape await Sagan's
committed API handoff; structural type checks must not force a historical AST
spelling merely for parity. Existing root/contracts/wildcard routes should suffice,
but moved-package imports/types must prove that on the actual candidate.

Parentage is explicit through `child(destination)`; operation.output is write-only
and does not silently confer a new ownership capability. A required file/header
operation must not be parented under a cancelable stdout-only operation. The
parent/sibling tests use an independent graph destination and inspect state at
specific barriers, not after whole-context teardown.

## New semantic holdouts

`CASES.json` freezes 36 cases with literal bytes, counts, reason-identity/state
checks and event ordering. They are not imported into canonical discovery before
the API exists. No blanket skips or passing placeholder tests are added.

| Family | IDs | Count | Required distinction |
| --- | --- | ---: | --- |
| Acquisition | A01–A08 | 8 | Registration first; synchronous/late failure; close/acquire races; idempotence; late work refused; drain all; preabort |
| Explicit graph | G01–G04 | 4 | Child draining; sibling and separate-Shell lease isolation; no implicit metadata parentage |
| Error selection | E01–E05 | 5 | Exact caller then execution rejection then cleanup; falsy reasons; nonzero fulfilled status; observed abandoned rejection |
| Accounting/bytes | B01–B06 | 6 | Exactly one accounting route; boundary publication; borrowed Buffer offsets; backpressure; no probes; nested shared budget |
| Destination isolation | D01–D04 | 4 | Required VFS body/headers/stderr survive stdout closure; close HTTP resources; cat stops without extra reads |
| Network | N01–N07 | 7 | Streaming upload, early-response shared cursor, acquisition abort, zero caps, real cross-origin policy, actual loopback client close |
| Legacy | L01–L02 | 2 | Optional capability/hooks remain optional; opaque pending input is not hard-preempted |

### Critical acquisition contract reading

A03/A04 explicitly admit **cooperative** resource-producing work through acquire.
After admission, close must cover its resolution/rejection and any produced
resource's asynchronous release. A03 holds each phase with observed gates so a
disposer that returns before resource resolution cannot appear successful. This
does not require awaiting every arbitrary host command/input promise: E05 and L02
separate unenrolled opaque work. A genuinely uncooperative admitted acquire can
remain stuck; no timeout that abandons an owned resource counts as successful
cleanup. Any proposed different acquisition contract must be routed explicitly
before candidate scoring, not compensated by fake elapsed-time success.

### Scheduling and observation discipline

- Use host-owned deferred gates released by observed acquisition/write/close
  events, not sleeps to manufacture ordering. A bounded watchdog is containment;
  firing it yields FAIL/TIMEOUT, never successful cleanup.
- Record raw ordered events and stable per-resource identifiers. Identity checks
  run before serialization and retain evidence of the actual selected rejection;
  message equality, truthiness, nonzero results and throw/reject are not substitutes.
- Do not expose resource hooks to the guest to make testing easier. Host-side
  instrumentation records admitted work without changing guest grants or budgets.
- Backpressure tests use direct controlled sinks where exact next/write counts
  are meaningful; do not forbid legitimate bounded pipeline read-ahead globally.
- B03 counts finalization, not an invented mandatory return after normal EOF.
  N02 deliberately tests an early response, not the false premise that a fully
  consumed upload leaves unread bytes for a later command.
- Resource assertions cover task-owned leases, requests, sockets, listeners and
  children. Other concurrent invocations may legitimately retain shared workers.
  No global-worker-zero, hard-RSS, arbitrary concurrent-buffer-mutation, rollback
  or universal process/opaque-host preemption assertion is made.

## Later admission and execution requirements

1. Receive exact production source commit(s), declared parent(s), API/declaration
   handoff and author scoped results. Verify reachability/bytes, full nine-path
   delta and preservation boundaries. Never use mutable HEAD as an accepted hash.
2. Build an isolated regular-file committed source copy using authenticated local
   tooling. Hash package.json/lock/build config/source separately; package.json
   SHA is not the emitted tree or npm tarball SHA. No private-repo build/install.
3. Pack and move/install only that package into a fresh consumer tree. Root,
   `virtual-bash/contracts`, `virtual-bash/contracts/output` and network imports
   must resolve from the same package. Bind all emitted/installed files and actual
   loaded main/worker entry modules; do not claim full worker import tracing if
   only the worker entry is observed. Deny source/alternate-package fallbacks.
4. Bind a real runtime binary/version/hash consistently for parent/children.
   Node22 product checks and any qualified Node24 guarded-loader profile are
   separate profiles, not an implicit engine-minimum change. Missing prerequisites
   are NOTEXECUTED/REFUSED, not passes. Do not silently switch runtime or hooks.
5. Execute the 36 holdouts through direct public helpers and actual public Shell
   as each recipe requires. Retain all failures/timeouts, raw bytes/status/effects,
   exact reason identities, and cleanup counters. No source mutation during runs.
6. Run unchanged scoped contracts/io, invocation-cleanup, cat/core and network
   regressions from that candidate, including zero-cap and retained-byte suites.
   Inventory exact discovered paths/denominators; external-oracle availability
   is explicit. These scoped runs do not become a full-product gate.
7. Re-run current-engine companion workflows using **regular copied files** only.
   Before copying, read applicable private AGENTS and inspect poe-code HEAD/status,
   index and relevant engine inputs read-only (`GIT_OPTIONAL_LOCKS=0`). Authenticate
   the copied runtime and actual loaded modules; deny imports back into the private
   source or mock engines. Do not assume historical264/63 counts describe current
   input/loaded sets. After execution compare the private state/input inventory;
   concurrent private changes are a qualified mismatch, not ours to revert.
8. Replay the prior 25 TEMP profiles against the newly bound production package
   with documented binding-only driver differences. Preserve original guest
   inputs/scorers and profile distinctions: surface six supported rows plus
   dialect-only and await-rejection rows, lifecycle and zero-cap cases separately.
   An unavailable actual engine is NOTEXECUTED, not acceptance by skipped tests.
   Fresh companion groups additionally target VFS bytes/cwd/env, nested owned
   child settlement, guest-unavailable cleanup capabilities, and actual rejection
   versus fulfilled nonzero status. Guest-driver literals are not frozen yet;
   disclose that later chronology rather than pretend this is a new blind25.
9. Run isolated behavioral mutants below, with original baselines immediately
   adjacent, then verify source/package/protected-directory inventories unchanged.
   Detect added/missing/changed/symlink entries after authorized setup. Preserve
   failed attempts in unique capture directories; no canonical evidence writes.

Strict positive types must preserve legacy ByteSink/context/HttpRequest construction
and demonstrate resource type inference, async releases, child/output use and root/
subpath assignability. Planned negatives: string byte writes, non-AbortSignal
consumerClosed, missing capability write/signal, wrong release-resource type,
non-cleanup return, invalid child destination and assignment to readonly signal.
Do not add uncompilable live .ts/.mts consumers before binding; later fixtures
must follow maintained-consumer routing, not a blanket exclusion.

## Planned behavioral mutants — not yet executed

| Mutation | Primary frozen detector |
| --- | --- |
| Register after acquire starts | A01/A03 |
| Close stops before admitted acquisition/release completes | A03 |
| Ignore explicit child draining | G01 |
| Abort every provider lease rather than the invocation's lease | G03 |
| Use truthiness to select an execution rejection | E02 |
| Treat fulfilled status7 as execution rejection | E03 |
| Bypass/double-charge the accounted sink or reset nested budget | B01/B02/B06 |
| Retain borrowed Buffer views instead of owned bytes | B03 |
| Abort whole context/file operation on stdout consumer close | D01/D03 |
| Stage complete upload before opening the transport | N01 |
| End owned HTTP cleanup without awaiting client request close | D02/N07 |
| Allow redirect/retry despite explicit zero host caps | N04/N05 |

Mutants must still compile/load and fail the intended actual behavioral assertion;
loader/build failure alone is not a mutation kill. No live product paths are edited.

## Five original custom first-read requirements stay separate

Authenticate and retain `tests/shell/first-read-probe.ts` and its existing helpers/
supervisor. Replay unchanged selectors `first-read-local`, `first-read-s3`,
`first-read-webdav`, `first-read-curl-body`, `first-read-curl-headers` separately
from this enrolled-operation cohort. Preserve the started-resource barrier and
1200ms inner bound. A no-start outcome or teardown rescue cannot pass them.
The separate head-zero control is not a sixth original requirement. Historical
0/5 remains historical; report new raw failures unless genuinely satisfied.
Do not silently add enrollment to these unchanged original inputs or infer their
closure from TEMP25, the 36 new cases, or Node cleanup on process exit.

## Preparation checks actually run

```sh
node tests/integration/owned-output-production-independent-20260827/scorer-controls.mjs
node tests/integration/owned-output-production-independent-20260827/verify-freeze.mjs
```

The scorer has **2 synthetic positive and 10 synthetic negative controls**. These
test only evidence assertions, not candidate behavior or product mutation kills.
No product driver is runnable/accepted yet; all36 product cases remain NOTEXECUTED.
There are no owned children, servers, private copies or retained live resources.
The exact API/candidate handoff is the next required input; no new design approval
or full-gate launch is requested by this preparation.

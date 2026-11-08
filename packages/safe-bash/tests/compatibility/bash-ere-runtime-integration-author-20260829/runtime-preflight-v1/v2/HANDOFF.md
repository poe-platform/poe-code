# CORE70 v2: owner controls complete; matcher-witness decision required

## Outcome

**HOLD, not 210-body READY.** No product, parser, engine, Shell, Worker,
compiler, package producer, native program or network ran. The previous
aa23f3fa/9b483bf2 packet remains exactly **189 authored bodies /21 gated cells**,
with all 210 runtime cells UNRUN. This revision does not relabel those gates.

Preseal `80ade641b` preceded the sole PURE controller execution. That execution
produced **18 PASS records: three syntax-only records, 13 synthetic owner
controls, and two harmless actual-child controls**. These are not additional
CORE70 passes. Both actual children closed naturally (PIDs 93768 and 93795,
codes 0 and 7 respectively); the controller exited 0. The nonzero child was
not relabeled exit0. Actual channel bytes were exactly `OUT\n` and `ERR\n`.
No real unknown-retirement, capture or integrity failure was observed.

The simulated missing-close case correctly left `retired:false` and reported
unknown retirement. It is deliberately not evidence of an actual process
cleanup failure or an actual process-reaping capability. The owner tests cover
partial descriptor acquisition, short/zero writes, capture-before-write caps,
raw falsy publication failure after enrollment, spawn rejection, typed clocks,
and final publication inside the total deadline. This new owner has **not**
been substituted into the 210-cell dispatcher or independently reviewed.

## Precise H02 capability question — request before implementation

The inspected, retained candidate has these source facts:

* `src/shell/runtime.ts:943` obtains the target watch before `session.execute`;
  its await is a usable publication boundary, not a matcher-progress callback.
* `src/commands/regex-execution/ere/transport/wire-engine.ts:13` constructs
  `new EreLedger(request.bounds, request.allowance)` internally. Its public-to-
  this-private-module input is the wire request plus entry-work count, not a
  checkpoint callback, factory, signal port or observer.
* `src/commands/regex-execution/ere/limits.ts` exposes the real ledger's
  `checkpoint` method, but the production worker creates its ledger internally.
  Parent `postMessage` proves request submission, not that matching has begun.
* The already sealed parent observer admits only the production static entry;
  it observes constructor/request/exit/channel facts and cannot observe a
  matcher checkpoint. Holding its eventual reply is **not** H02's frozen
  in-flight actual-matcher observation.

Recommended narrow decision: permit a **separately classified instrumented
H02 worker role**, not a new public product API. Its static closure would import
the exact accepted `limits.js` plus the unchanged production worker entry. A
bounded, forwarding ledger-method observer would arm on `subjectBytes` input
admission and hold the first subsequent checkpoint, retaining original argument,
return/rejection and charge semantics. A fixed witness message would need an
explicit parent observer filter, before the transport reply validator, so the
test-only witness cannot be mistaken for a production reply. The wrapper and
filter must be whole-file hashed roles, with bounded messages, counts, deadline
and termination ownership. No dynamic source, arbitrary URL, payload mutation,
ledger injection, relaxed production reply validation or public seam is proposed.

This requires deciding that this **instrumented worker-local witness** is an
acceptable H02 proof class. It is not an unmodified-worker outcome, not a nested
module-load witness and not a new transport capability. I have **not** implemented
or executed that extension, and have not silently substituted submission/reply
timing for the frozen matcher-in-flight requirement. An alternative narrowing
of H02 to request submission would change the original requirement and is not
recommended.

## Remaining bodies — no circular design hold

| ID | Concrete state and remaining work |
|---|---|
| H02 | The explicit instrumentation decision above; original body remains gated. |
| H03 | Fixed grammar boundaries and configured public B/F scenarios still need concrete body authoring. No new policy decision is asserted. |
| H04 | Public capture strings alone cannot establish simultaneous private snapshot/ticket accounting. A source-bound forwarding private-array observation adapter still needs authoring and an explicit dynamic-versus-source proof map; no lower private counters or invented public ledger API is authorized or proposed. This is not a product defect. |
| H05 | A held validated production reply can establish post-watch/pre-publication timing for actual context.invoke mutations; this is distinct from H02. The exact forwarding adapter and cases remain unwritten, not silently waived. |
| H07 | Literal owned malformed-worker roles are allowed to be authored, but full role/reply-kind/counter mapping remains unwritten. None ran or gained admission. |
| EH04 | Explicit existing registerCleanup and sink/caller precedence bodies remain unwritten; no inferred ownership of opaque promises. |
| EH05 | Exact invoke-Promise versus derived-Promise cases remain unwritten; no blanket expected rejection/status is invented. |

These six authoring gaps are **not** being misrepresented as six unresolved
ROOT policies. All seven IDs and their 21 layout cells stay visibly gated.
Consequently there is no truthful complete new 210-cell execution command or
revised Worker/thread/start census to authorize in this packet. Existing
prospective v1 counts are not activated or silently reused. Transport60 and
different CORE preexec review remain additional independent gates.

## Binding and limits

The inspected source is the retained da4e1cc187022255521879b00db2ac77674f79d9
composition (305 inputs), not mutable HEAD, B35 or Node309. The inherited full
1002-member package remains SHA256
`4f90df04dba998f184473254bb450f9e085b9fc9d5994dc91a21a7ccf1d1d66e`,
908381 compressed bytes. Neither package nor product files were changed,
inflated, installed or executed in this revision. A fresh all-1305-member
authentication was **not** performed here and is not inferred from the package
hash. Static source closure qualification remains 29 relative imports, one
Worker URL edge and four builtin import edges; these counts are not merged.

The actual PURE controller authenticated its own sealed files before importing
the new owner, streamed the exact Node22.22.2 binary hash before child launch,
and verified connected external stdout/stderr descriptors against declared
regular capture files before further admission. Source syntax checks used
SourceTextModule construction only, never evaluation. The experimental VM
warning is retained verbatim. The controller rechecked all five sealed file
hashes afterward. There were zero Worker or loader starts.

All executed entries/cwd/home/tmp/captures were under the canonical private root
`/private/tmp/safe-bash-core70-v2-20260829-controls`. Existing old private roots
and source/package captures remain untouched. No cleanup is claimed or attempted
for those old roots. New tiny fixture/capture files remain retained.

## Process/capture qualification

START.json records the phase start and exact 20-minute deadline. The actual
controller records three known starts with PIDs and close facts (controller plus
two children); administrative shell, read, patch, staging and Git roles are
listed separately in CENSUS.md. They are not fake runtime starts or reservations.
The overall administrative wrapper/transitive census is not independently
certified; do not turn the controller's measured `actualKnownStarts:3` into a
whole-phase cap certificate. No historical process probe, invented PID, or
retroactive startup capture was used to fill that gap.

Only owned explicit paths are published. Foreign source and staging were not
edited or broadly staged. Global index byte identity was not sampled, so no
stronger index-identity measurement is claimed. Original failures, 16 PURE
controls, 189/21 body map, package, and prior source/type/producer evidence remain
literal and unrescored.

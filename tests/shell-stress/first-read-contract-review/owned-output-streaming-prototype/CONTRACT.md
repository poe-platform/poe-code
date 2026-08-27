# Owned Output Streaming Experiment Specification

Status: Proposed
Implemented Through: Not applicable
Purpose: Bound a TEMP streaming output-ownership experiment without altering live input ownership.

## Normative Language

MUST, MUST NOT, SHOULD and MAY have their RFC 2119 meanings. This document
supersedes the rejected prebuffer proposal only for this new cohort; old evidence
and failed profiles remain immutable. Tested temporary source/hashes belong in
SEAL.json, not the live-product Implemented Through field.

## Problem Statement

An opted-in operation needs to stop its owned IO when its output consumer closes,
without cancelling independently owned input, files, stderr or siblings. A public
pipeline result, operation cleanup completion and stage abort are distinct events.

## Goals and Non-Goals

User decisions: curl stdin MUST remain streaming and backpressured. The output
operation MUST NOT return/cancel independently borrowed stdin. Already consumed
bytes MAY be discarded on cancellation. No lease API, input handback, rollback,
universal cursor conservation, global stage cancellation or demand gate is allowed.
Existing top-level Shell.exec input-owner cleanup MUST remain unchanged.
This reduced experiment is not closure of all five historical failures, a release
gate, production permission, superiority evidence or a 72-hour completion claim.

## Boundary and Types

S1 retains optional ByteSink.ownedOutput with consumerClosed and write, plus
createOutputOperation(context, destination). The returned operation exposes
signal/output/registerCleanup/acquire/close/child only. No new input type exists.
The existing InvocationCleanup hook is reused; optional HttpRequest.registerCleanup
is a TEMP proposal. Custom plugins MUST explicitly opt in. Known cat/curl owned IO
MUST enroll before acquisition. Opaque sink wrappers do not imply parentage;
parent.child(destination) explicitly declares it. Host callbacks remain trusted,
cooperative JavaScript, not a sandbox or universally preemptible host service.

## States and Ordering

Engineering policy: open -> closing -> closed; abort first records its reason,
then closes. Normal close MUST synchronously stop admission without fabricating
abort/EPIPE. Repeated close MUST share completion. Cleanup MUST register with the
existing host hook synchronously before acquisition/admission, with the same
idempotent close used from finally. Parent termination MUST refuse new children
and late acquisition and close registered children; cooperative registered cleanup
MUST complete before close/public settlement. Child close MUST NOT close its parent
or siblings. Opaque pending acquisition need not delay close; its eventual resource
MUST be released and its rejection observed, without claiming universal drainage.

## Streaming and Ownership

Curl-only stdout closure MAY cancel its request/upload via the honored operation
signal. Curl MUST NOT collect the entire stdin solely to solve cancellation.
Existing bounded replay caching, writeout-format collection and GET-query
preparation are distinct semantic operations. Retained producer fragments MUST
be copied before producer advancement/finalization; Buffer.slice/subarray are
not copies. Awaited transient writes need not copy indiscriminately.

Engineering policy: a next-only internal adapter prevents cancellation from
returning borrowed stdin; it does not rewind or preserve every read cursor.
Opaque pending next MAY remain pending; late fulfillment/rejection MUST be
observed/discarded under ordinary cancellation. Tests MUST hold an actual invoking
owner live; zero returns after top-level owned exec is not an invariant.
Required -o/-D file work MUST use a lifetime independent of stdout closure;
stdout header/body/writeout publication remains separately scoped. Necessary
network/file work and independent stderr/siblings MUST remain possible. Caller
abort MAY cancel invocation-owned work without transactional rollback.

## Failure Model and Precedence

Engineering policy: first operation reason wins; an already-aborted caller wins
enrollment. Existing caller-public precedence, genuine command statuses and
rightmost pipefail semantics MUST remain intact. Cleanup runs all callbacks:
one failure is rethrown, multiple failures aggregate in registration order.
An explicit finally close can replace a prior thrown error; close is not an
exception-precedence combinator. Caller precedence is applied by the existing
invocation/runtime boundary. No claim covers uncooperative host cancellation.

## Test and Validation Matrix

Frozen author controls (at most eight; subruns are not extra logical cases):

| ID | Required evidence |
| --- | --- |
| S1 | Streaming before EOF, bounded/backpressured reused binary chunks, exact replay copies |
| S2 | Stdout-only honored transport upload cancellation; cleanup and stage/public outcomes separate |
| S3 | Actual context.invoke borrowed owner stays live; consumed discard allowed; late opaque fulfillment/rejection observed |
| S4 | Mixed required -o/-D, stdout writeout/header, independent stderr and sibling file effects survive |
| S5 | Explicit parent/child normal/abort closure, late admission refusal, shared cooperative cleanup, opaque late acquisition |
| S6 | Caller/public and first-operation precedence, genuine errors, pipefail and cleanup failure rules |

Original5 exact probes/hashes/deadlines/barriers MUST be replayed and individually
reported without rewriting expectations. API opt-in5 bindings are separate;
authenticated v1 adapted paths are reusable with exact relocation delta. Old57+9
controls MUST remain unchanged. Historical native5 is reference only. Old v2
author8 and historical new7 are not new acceptance. At most three focused source
self-fix rounds are permitted; raw failures and fixture corrections MUST remain
separate. Scoped copied build/typechecks and compiler manifests are required;
no main-repository full suite or global typing gate is implied.

## Conformance Criteria

Only the frozen TEMP source and enumerated evidence may support this contract.
Every MUST requires mapped evidence; unsupported observations MUST remain explicit
limitations. Read-only seal includes source/tests/API/patch/tool/compiler identities,
inert restore instructions and compiled declaration/import paths. The author MUST
exit normally and root MUST observe actual CLOSED before independent execution.

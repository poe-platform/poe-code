# Qualified Output Operation Specification

Status: Proposed

Implemented Through: Not applicable

Purpose: Qualify the minimal TEMP owned-output operation against the existing invocation contract, without authorizing production changes.

## Normative Language

MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are normative requirements. Implementation-defined choices MUST be stated with their tested profile.

## 1. Problem Statement

An output consumer may close while a command still owes independent file, header or stderr effects. A local output operation is not the whole stage. Its closure and public invocation outcome require separate observations.

## 2. Goals and Non-Goals

The operation MUST bound explicitly enrolled output work and preserve streaming, byte ownership and cooperative cleanup. It MUST reuse `registerCleanup`, not introduce a second invocation lifecycle or public error-precedence API. This proposal MUST NOT imply production authorization, full release qualification, superiority, general preemption, cursor conservation, universal handback or opaque-handler drain. No lease, borrowed-input flag, upload prebuffer or demand gate is permitted.

## 3. System Boundary and Types

The actors are the trusted host, invocation owner, opted-in output operation, its explicit children and destination. `API.txt.data` defines the exact declaration profile. A destination's optional `ownedOutput` capability supplies consumer closure and accounted writes. Known cat/curl boundaries enroll automatically in TEMP S1; arbitrary plugins MUST opt in. No ambient network capability is introduced.

## 4. Admission and Closure

Operation construction MUST synchronously register its idempotent close callback before owned admission. States are open, closing and closed. Close MUST synchronously refuse new acquisition, cleanup registration and children, and share one completion promise. Parent close MUST close child admission and await cooperative child cleanup; child close MUST NOT close its parent or siblings. Cleanup callbacks MUST all be observed even when one rejects.

Normal close MUST NOT abort the operation signal. A later caller abort MUST NOT retroactively abort a completed normally closed operation. While accepting, first observed operation abort closes the operation; this local rule MUST NOT replace public caller-abort precedence. Cancellation MAY discard consumed bytes. The operation MUST NOT return independently borrowed stdin or cancel unrelated file/stderr/sibling work. Top-level input ownership remains unchanged.

Cooperative acquisition cleanup MUST cover admitted owned work. Opaque host promises are outside the drain guarantee; late acquisition/rejection MUST be observed and eventual owned resources released. The operation is not an arbitrary host-JavaScript sandbox.

## 5. Public and Local Failures

The existing `src/contracts/command.md` remains authoritative for public settlement: caller abort by exact reason identity, then selected execution rejection, then cleanup failure, then command result. A single cleanup rejection MUST preserve its value; multiple failures aggregate. `0`, `undefined` and Error values MUST NOT be classified by truthiness. Local IO throw identity MUST be measured independently of public selection and local abort state.

Owned code MUST NOT allow an awaited finally-close to overwrite an established execution throw. It MUST record whether execution failed independently of its value, await/observe close, preserve the primary, and otherwise propagate cleanup-only failure. The registered shared close promise MUST remain available to the invocation drain so secondary failures are not silently lost. The executable consumer pattern is archived inertly with the author controls; it does not add a public helper. Direct hosts MAY omit the optional hook but MUST still close their owned operations. No opaque losing-handler wait is required.

Native AbortController default and `abort(undefined)` reasons MUST be distinguished from actual `signal.reason === undefined`. Literal undefined execution and cleanup throws are valid controls. A synthetic caller signal is not part of this cohort.

## 6. Curl Publication and Independent Effects

Once stdout consumer closure is known, an output operation MAY close without attempting a write. Requested `-w` handling MUST nevertheless retain documented product status/stderr/error/pipefail semantics. A positive writeout control MUST distinguish intentional no-attempt from a missing writeout path. Genuine output failure MUST NOT become success. Required `-o` body and `-D` header effects and independent stderr MUST finish under their independent lifetimes.

Existing captured product behavior, native curl behavior and proposed operation behavior MUST be reported separately. Native curl exit23 or pipe statuses MUST NOT be imported as product policy without an existing contract basis. The native profile is bounded loopback and version/platform/library qualified, not universal POSIX/GNU/BSD equivalence.

## 7. Configuration and Security

Only authenticated existing tooling and copied candidates MAY be built. Native curl MUST use `-q` first, explicit loopback routing and an allowlisted environment without proxies or credentials. No dependency install, live build, live source/API/config mutation or current full-suite claim is authorized.

SafeJS privileged facade/guest membrane audit: **NOT AUDITED**. Before promotion the host MUST audit `ownedOutput`, `consumerClosed`, accounted-write and cleanup hooks across facade and guest membranes. Metadata MUST NOT be presumed safe to expose. No live SafeJS changes are authorized here.

## 8. Evidence, Recovery and Open Questions

Exact source, tests, compiled output, tools, baseline capture interval and patch identities MUST be retained. Current snapshot bytes do not freeze current HEAD. Raw failures MUST remain beside any correction. At most two coherent TEMP source-fix rounds are permitted; a broader live-runtime blocker MUST be reported rather than rebasing the product. Whether all independently frozen controls conform remains open until root launches the independent executor after observing actual author exit.

## 9. Test and Validation Matrix

| Requirement | Bounded evidence |
| --- | --- |
| Writeout/no-attempt versus true output failure; file/header/stderr; pipefail | Q01, eight curl profiles, original/current/S1/native reported separately |
| Public reason identity, local throw, normal close, cleanup rejection | Q02, twelve focused precedence parameters through actual Shell |
| Parent/child admission, independent child close, drain sharing | Q03 |
| Borrowed owner remains live, no sibling/stderr cancellation | Q04 |
| Streaming/backpressure and retained reused buffers | Separate unchanged S1 author replay, not new controls |
| Historical 57+9 and original5/optin5 | Separate historical replay only, not new closure claims |
| SafeJS membranes | NOT AUDITED; blocks production promotion |

## 10. Conformance Criteria

A reported pass MUST name its frozen profile and actual denominator. Historical 12 logical (10 PASS/2 BLOCKED), 20 parameters (17 PASS/3 BLOCKED), original5=1/5, earlier9/8/3 and rejected-v2=3/7 remain immutable and do not count as this cohort. Proposed S2 MAY equal S1 when no source correction is justified. Repository captures MUST be inert `.data`/`.patch-data`; executable copies stay in task TMP. Root alone observes actual exit and controls fresh independent execution.

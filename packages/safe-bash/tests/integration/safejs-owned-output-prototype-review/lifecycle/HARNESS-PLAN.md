# Frozen lifecycle driver plan — no execution authorization

## 1. Binding and classification

The eleven rows in `CASES.json` are the entire cohort. Shared guest files are
byte-identical within positive/negative pairs; only the explicit row metadata
differs. No automatic retry, hidden calibration guest, native comparison, general
reflection corpus, old worker cohort or Q1 32-case replay is included.

Until ROOT releases execution after the separate receipt verifier exits, every
row is `UNRUN_RELEASE_REQUIRED`, syntax/reachability is `UNPROVED`, and there are
no passes. After release, unsupported syntax/API is `INVALID_FIXTURE`; unavailable
provenance is `BLOCKED_INPUT`; missing causal observation is `UNPROVED`; an actual
observed assertion mismatch is `FAIL`. A valid negative needs its paired positive
and actual engine-entry/admission markers. Deadlines never convert failure to pass.

Do not count a returned zero alone. Count a pass only after exact bytes/results,
identities, counters, event ordering, before-settlement ownership, process exit
and source/import guards all agree. Preserve the original report if any fixture
is later corrected; require a versioned freeze rather than altering the oracle.

## 2. Source and public API boundary

Read the actual S1 `owned-output-streaming-prototype/CONTRACT.md`, qualified
`owned-output-qualified-prototype/CONTRACT.md` and final
`owned-output-qualified-review/ordering-replay-q1/REPORT.md` before this plan.
Their hashes, the f666 preparation receipts, exact inspected prepared source
files and loader are bound in `SOURCE-PINS.json`.

Actual TEMP API:

- `ByteSink.ownedOutput?` contains **consumerClosed and write**. There is no
  `accountedWrite` field or named `OwnedOutput` runtime export.
- Public `createOutputOperation(context, destination)` accepts signal and optional
  registerCleanup from a real CommandContext. The returned members are signal,
  output, registerCleanup, acquire(start, release), child(destination), close.
- Import from the copied package root `virtual-bash`; `virtual-bash/contracts`
  and `virtual-bash/contracts/output` are also actually exported. Types remain
  types. Do not import internal `shell/runtime`, `GuestOutput` or `GuestInput`.
- `operation.output` forwards **write only**. It does not propagate capability
  metadata or implicitly parent another operation. Parentage is explicit child().
- `safeJsCommands` supplies guest `fs`, `stdio`, `command`; command exposes args,
  cwd, env and setExitCode, **not command.exec/invoke**. The host uses context.invoke.
- The only added guest module is public `makeSafeJsShellModule`'s `shell.exec`,
  with explicit FS, signal, read-side-effect policy and actual declareHostOperation.
  Its guest options are cwd/env/stdin and its results stdout/stderr/exitCode.
- Curl is separately installed with public `curlCommands` and explicit authorize
  and transport. It is not part of a default aggregate or guest network grant.

Source-only private hooks are `run.ts:run`, `interp/budget.ts:Budget`,
`modules/fs.ts:makeFsModule`, `interp/host-bridge.ts:declareHostOperation` in the
regular engine copy. Do not load its private barrel or external private packages.
These are the real implementation functions, not a fake interpreter. No source
patch, budget reset, fake run result or injected guest operation/sink/control hook.

The prepared source shows async arrows, finite for loops, namespace imports,
Promise.resolve/then/catch/all and ordinary top-level return/await in the actual
engine's existing tests. This is syntax-design evidence, not parsing or execution
of our guest bytes. No queueMicrotask, setTimeout, process, fetch, dynamic import,
class, reflection enumeration, invented host callback API or runaway guest is used.

## 3. Driver and legitimate host construction

One Node22 child per row, serially. The parent only materializes/verifies regular
files, spawns its known child, records output and enforces its deadline. Product
and engine imports occur **only in the child after release**. Parent never imports
them, even for a positive control. Use the same prepared Node22.22.2/Darwin arm64
profile; do not silently substitute runtime, package or tooling versions.

Each child creates MemoryFileSystem, `/work`, and an outer public Shell. It
registers the fixture command `owned-guest` and the real safeJsCommands plugin.
`outer.exec("owned-guest", {signal: caller.signal, ...explicitSinks})` is the one
public invocation. The fixture calls its actual `context.invoke("safejs",
["-e", exactSource, "--", ...guestArgs], ...)`; source is never shell-interpolated,
eval'd by Node or granted via an extra module. Outer stdin is empty and explicit.

At entry assert registerCleanup and invoke are real functions. A host-only
forwarding context records cleanup enrollment and delegates unchanged to the
actual registerCleanup. Construct the real output operation **before acquiring
its counted fixture resource**. Its destination is a host-owned ByteSink whose
ordinary write and optional capability write have distinct counters; capability
write awaits the actual context.stdout.write. Its native consumerClosed controller
is host-only. Feed only `operation.output` as the nested safejs stdout; stderr stays
independent. No product context, hook or capability is returned to guest code.

The fixture resource has one identity, one acquisition, an idempotent release and
a recorded completion. Release is cooperative and belongs to the operation. The
same close is used from finally and the real invocation hook; repeated close calls
may occur but resource release must happen once and completion must be shared.
Never use an unqualified `finally { await close(); }` that replaces a primary
execution exception. Record execution-failed and cleanup-failed booleans separately
from their values, observe both, and apply the qualified consumer pattern. Keep
the original registered close promise available to the real invocation drain.

For shell-module rows, acquire an inner public Shell as an explicitly owned host
resource with release `inner.dispose()`, registered before construction/admission.
Install only that row's fixture commands (plus curl for L06). Inject
`makeSafeJsShellModule((source, request) => inner.exec(source, request), ...)` using
the exact `options.signal` received by runtime.run. The executor may record
entry/settlement but must delegate the unchanged request/result. Capture the actual
run result/error and Budget identity at the injected host boundary without editing
them. Never deep-wrap facade functions, change asyncness, or grant new callable
properties solely to obtain an observation.

The SafeJS wrapper does not opt in to ownedOutput itself. The fixture's explicit
opt-in and TEMP cat/curl implementations are separate actors. This plan neither
requires implicit opt-in nor presumes every pipeline is an operation parent.

## 4. Causal schedules

### L01: legitimate finite aliases

Run the exact alias guest through the real stdio and command modules. Verify the
two actual capability writes, binary bytes including 00/7f/ff, independent stderr,
setExitCode(7), and resource release before public settlement. Ordinary destination
write must not substitute for capability write. No reflection or enumeration is
needed; this establishes genuine supported host effects before negative probes.

### L02: budget in a queued callback, paired bytes

First run maxSteps 200000, then 2048 against the same source. The guest awaits a
real prefix write before scheduling a finite 4096-iteration Promise callback. The
positive must return 4096 and deliver both exact strings. The negative must reach
the prefix and actual engine callback route, fail the real **steps** budget before
the second host write, diagnose the exact recorded budget error and release owned
resources. Timeout/output/call-depth failure, parse failure, an unadmitted callback
or an unsuccessful positive is not a successful step-budget guard. No budget
inflation, retry, synthetic tick call or new host callback grant is allowed.

### L03: queued work while live versus after invocation lifetime

`owned-hold` is a real registered inner command with a bounded cooperative gate,
registered close/release before acquisition. It records admitted work and returns
an ordinary status when its owner releases the gate. `owned-late` is another real
command with a counted write to `/work/late.txt` of exactly `late\n`.

The guest attaches both fulfillment and rejection continuations to shell.exec,
observes the chain's rejection, then awaits the `queued\n` prefix. In the live
control, the host releases owned-hold on that actual prefix write; the callback
must emit `callback\n`, invoke owned-late once and create the exact file.

In the detached row, keep the hold admitted until actual run returns and the
production SafeJS invocation signal aborts in its normal finally. Release the hold
only through its already-registered cooperative close path, while the owning
resource's close/dispose is awaited. Record signal reason as actually supplied,
hold/executor settlement, late-command admission and effect bytes. Before public
settlement there must be no callback output or `/work/late.txt`, and all owned
cooperative work must be done. No fabricated timer delivery or retained raw guest
closure call is allowed. Do not wait until after public settlement to close it.

The positive proves the same aliases and continuations can produce the effect.
The negative proves at most the scoped absence of unauthorized host effects
through these actual lifetime-checked facades. It does **not** prove zero pure
guest instructions after return. If the queued/admitted/settled event chain cannot
be established without an extra guest control grant, record UNPROVED; do not turn
absence of observation or a pending unresolved Promise into a security pass.

### L04: explicit children, sibling isolation and late admission

Use a separate graph parent operation under the real outer invocation, independent
of guest stdout. Before each leaf acquires its resource, explicitly create it with
graphParent.child(destination) and register the same child.close with the inner
command's actual hook. No implicit parentage through operation.output is assumed.

The real guest concurrently calls left and right leaf commands via shell.exec.
Left writes `left\n`, normally closes and releases once. Right's first write waits
for that actual left-close completion, then writes `right\n`; its signal and
resource must remain live. Parent and right must not have closed as a side effect
of left.close. Hold right's cooperative cleanup through a host-owned gate.

On the actual right-write event, normally close graphParent. Record synchronous
admission closure before asynchronous drain, right cleanup entry and public/parent
settlement still false. Try one late acquire and one late child on that same parent
from the trusted host; their start/resource callbacks must not run. Release right
cleanup only on this observed barrier, not after a delay. Await shared parent close.
The guest's later `owned-leaf late` reaches the actual command and is refused by
that same closed parent; record helper refusal, zero starts and explicit fixture
status3. The other fixture leaf statuses are0. Outer guest stdout remains usable
and emits `[0,0,3]\n`. Normal parent close must not fabricate an abort/EPIPE.

This is one guest-reachable explicit graph, not all pipeline parent/child ownership.

### L05: exact caller / selected execution / cleanup precedence

Use the same finite guest for all three rows. Construct callerError,
executionError and cleanupError once, with the exact messages in CASES.json.
The first stdio write must succeed; the second is the controlled host boundary.
Enroll the resource cleanup before that write. Its held cooperative release
records cleanup-enter, public-pending, release and rejection with cleanupError.

- Caller row: when the second host write is actually pending, abort the public
  caller with callerError. During registered cleanup, reject the admitted write
  with executionError, observe its rejection and release cleanup with cleanupError.
  Public rejection must be the original callerError reference. This local late
  write error is **not claimed to be a selected execution rejection**; no opaque
  losing-handler join is added.
- Execution row: second output write rejects with executionError; the actual
  public diagnostic sink also rejects with that **same** Error. Record each
  diagnostic attempt and source propagation. Merely throwing in a guest/utility
  does not establish a selected raw rejection. With no caller abort, require the
  selected public executionError reference and separately observed cleanupError.
  If only a command status is selected, preserve that observation and classify the
  precedence construction UNPROVED/invalid rather than loosening the assertion.
- Cleanup-only row: both writes succeed and the real guest returns success.
  Do not introduce a public diagnostic rejection. The sole registered cleanup
  failure must surface as the same cleanupError, not a successful status.

All identity checks happen before serialization; record whether a value is
present separately from its value. Every secondary failure must be observed.
One local operation can close normally without changing public caller precedence.
No parser-selector copy from the old Q1 cohort, arbitrary expected-reason coercion,
raw grep-error mistake, uncooperative join requirement or source fix is introduced.

Native AbortController.abort() and abort(undefined) use the actual non-undefined
default AbortError. This cohort has no synthetic literal-undefined caller override.
If production finally aborts without an argument, retain its actual reason; do not
label that event literal undefined. The Q1 synthetic public override/backing
AbortSignal.any distinction remains historical, not a new API requirement.

### L06: one streaming curl workflow, open/closed controls

Guest shell.exec invokes a real registered `owned-curl` fixture. It invokes the
actual registered curl with the exact literal argv in CASES.json and an explicit
host-owned finite upload ByteSource. It replaces stdin deliberately through
context.invoke; this does not pretend the shell module's string stdin exposes a
custom iterator. Both rows use identical upload/response/file bytes.

Provide an explicit public HttpTransport, not NodeHttpTransport or a server. Its
authorize callback accepts only the frozen URL and PUT, once, with no redirects.
Transport synchronously registers cooperative cleanup via the actual optional
request.registerCleanup before starting upload/body work. Assert this hook is
present rather than silently fabricating it. Record that input.body is streaming.

Use a three-byte reusable producer buffer for the two upload chunks, retaining
copies in the transport before requesting the next chunk. Pause the second chunk
at a host barrier. On first actual transport receipt assert producer EOF is still
false. In the closed row abort **only the curl stdout consumer** with the frozen
EPIPE Error, then permit the second chunk. Open control uses the same barrier but
does not abort it. Neither profile prebuffers the complete upload before transport
entry. Emit the two response chunks and exact fixed headers only after upload EOF.

The curl destination has actual consumerClosed/accounted write. Because -o and -D
request required file effects, the main transfer lifetime is independent of stdout
consumer closure. Verify request signal is not aborted by that closure, exact
upload bytes, `/work/body.bin`, `/work/headers.txt`, independent `stderr\n` path
(the actual payload is `independent-stderr\n`), response dispose and registered
transport cleanup before inner/public settlement. The fixture writes independent
stderr and returns curl's actual status unchanged. No successful return invented.

Open control must actually publish writeout `200\n`. Closed control must attempt
the product writeout path but not call its aborted capability write; direct curl
status141 is frozen separately from pipeline default/pipefail or native curl
status23. Capture exact actual status/bytes even on mismatch; do not adjust these
expectations after a run. The guest forwards returned stdout/stderr and status
through its existing facades. This is an injected-transport integration, not a
deployed network service, native oracle or universal cancellation proof.

## 5. Events, resources and containment

All journals use monotonically increasing integer order and child-local counters.
Required events include engine-entry/return, real-command-entry, hook-register,
operation-create, acquire-start/complete, capability-write-enter/settled,
consumer-close, callback-trigger boundary, caller-abort, child/parent-close-start,
release-enter/done/reject, facade-executor-settled, inner-exec/dispose-settled and
outer-public-settled. Record signal/reason identities at meaningful events.
Operation close calls and resource releases have separate counters.

An assertion inside a release gate first checks publicSettled is false; it then
releases its own cooperative resource. It must not wait for public settlement,
manufacture a success via rescue, or sleep until a presumed scheduling point.
Track rejected promises at creation. Explicitly admitted cooperative work is
drained; opaque host promises remain outside the claimed guarantee.

No row needs a native worker or tool subprocess: the copied TypeScript source
loader transpiles in the case process. Install host-only containment before
imports: record/deny unexpected Worker construction, subprocess launch, native
network/DNS/socket creation and writes outside the owned TMP. Allow loading Node
builtins needed by actual engine/public source, not their unauthorized effects.
If any unexpected handle is actually created, record failure and close only that
known handle; it cannot become an accepted row. No model-agent or poe CLI spawns.

Child timeout7000ms and parent watchdog9000ms are failure containment only. The
parent owns one explicit ChildProcess, kills only that handle on deadline/output
overflow and waits for close. Never kill by name, broad process group, PID scan or
foreign ownership inference. Whole cohort deadline120000ms; no automatic retry.
Stop launching rows after a missing positive prerequisite or containment failure;
mark remaining rows unrun with reason rather than claiming a smaller denominator.

Each child must exit naturally, with outer/inner Shell disposed, resource counts
zero and all known timers/listeners/children closed. Parent records exit0/no signal,
bounded stdout/stderr and a complete structured proof. Record failures before
teardown; teardown cannot change before-public-settlement snapshots into passes.

## 6. Release-time provenance and durable cleanup

Fresh private queries use GIT_OPTIONAL_LOCKS=0 and no private cwd execution. Hash
HEAD/tree, index/status/staging, AGENTS.md, .gitignore, package.json,
package-lock.json, tsconfig.json, packages/poe-agent/package.json and all264 engine
regular files before copying and after execution. Read applicable instructions.
Unexpected foreign drift qualifies the capture; never reset, revert or rebase it.

Copy authenticated prepared engine/package/loader/tools to a unique owned regular
TMP tree with isolated cwd/HOME/TMPDIR/TMP/TEMP and caches disabled, including
TSX_DISABLE_CACHE=1. There is no private package install/build or cache/config
write. Copy bytes unchanged; do not use symlinks or live-private fallback. Freeze
full package/engine/tool/loader/harness inventories before any import. Bind
SURFACE_ROOT/SURFACE_IMPORTS to the new owned tree/log for the existing loader.
Do not execute the loader during this preparation phase.

Verify all actual load paths and import hashes against those inventories. Negative
package-boundary imports must refuse live product dist/source, the private live
checkout and unexported internal paths. Record the actual public export entry and
all loaded private definition modules, not an inferred graph count. Recheck all
source, package, engine, tool and loader hashes after execution; distinguish
unrelated live checkout inventory from immutable prototype identity.

Write captures only to a fresh versioned owned evidence directory; never rewrite
committed evidence through a canonical test. Persist raw failures, final manifests,
event/effect/identity assertions, owned-handle closure and private before/after
before removing only this worker's temporary copies. Never remove the preparer's
shared tree or another worker's files. Commit explicit owned paths atomically,
preserve foreign staging, publish the bounded result, then stop for ROOT routing.

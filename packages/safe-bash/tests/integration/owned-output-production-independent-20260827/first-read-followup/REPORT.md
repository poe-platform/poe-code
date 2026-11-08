# First-read production facts — 2026-08-27

## Scope and conclusion

Frozen product `eba049535d154f4e028f57ffd8efd7622b2239ca`, tree
`62d75ef09e89d4d3b6afc032c518d2846dcd03b7`; exact previously built tarball SHA256
`280b76a2a3577176716534e13d2e10475eb8a13e423190a24d25555a050f72e1`.
Two fresh regular-file installations authenticate all826 package files and
actually loaded package modules. Node22.22.2 is pinned by path/hash in each binding.
No live runtime/command/contract overlays, private checkout access, dependency installs,
root configuration, AGENTS or canonical-test edits.

**No enrolled production failure was demonstrated.** The old local producer is
not enrolled and genuinely remains pending; registration alone does not connect
destination closure to its signal. Explicit operation enrollment makes the
otherwise same cooperative source close. HTTP public work closes its operation
without aborting the caller/whole command. Remote server close notification is
later than client-side completion, but arrives before observer cleanup/dispose.

This is24 naturally completed **observer processes**, not24 passing original
tests: six original recipes and six NEW recipes, each repeated twice. The old
canonical2/6 (five requirements1/5 plus the passing head-zero control) remains
unchanged in35909b63. No original assertion was skipped, rewritten or rerun with
different expectations; these are separately authored observational drivers.

## Original recipe observations (both repeats)

| Recipe | At public settlement / observation boundary | Before harness cleanup |
| --- | --- | --- |
| first-read-head-zero | Public0; reads0, return1; caller live. | No forced release. |
| first-read-local | **Not settled at1200ms**; active1/read1/return0. Cleanup hook and destination metadata are available, but handler registers0 callbacks and creates0 scopes. | Still pending. Only subsequent, explicitly marked harness caller abort permits finalization; not counted as success. |
| first-read-s3 | Public0; source operation EPIPE, caller and cat context live; source return1/active0. | No forcing or rescue. |
| first-read-webdav | GET operation EPIPE, fetch request rejected/settled before public0; caller and cat context live. GET response has not been acquired in these runs. | Server GET closes passively after public settlement, before Shell.dispose and before server cleanup. |
| first-read-curl-body | Transport EPIPE; its cleanup finishes and actual ClientRequest close occurs before public0. No HttpResponse acquired despite server-flushed headers. Caller and curl context live. | Server response closes passively before dispose/cleanup. |
| first-read-curl-headers | Same acquisition-stage cleanup; server has not sent headers. ClientRequest closes before public0. | Server response closes passively before dispose/cleanup. |

The raw first-read HTTP assertion observes `context.signal`, not the owned
operation/transport signal. The WebDAV observer distinguishes PROPFIND metadata
reading from GET acquisition: v1's completed reader was **PROPFIND**, not GET.
Therefore neither server-side `flushHeaders()` nor the old `curl-body` label is
proof that the client has entered body reading. The initial progress shorthand
about a WebDAV reader must be read with this explicit stage qualification.

## Separately labelled NEW bindings

- `new-local-cleanup-only`: registration occurs before reading, but the source
  still waits1200ms because it uses whole-context signal. No callback executes
  before teardown. This negative observation is not an original-case pass.
- `new-local-enrolled`: createOutputOperation registers the invocation cleanup;
  acquire registers release before constructing/admitting the source; pending
  read uses operation.signal and pipeBytes uses operation.output. Source and
  release each finish once before public0; operation EPIPE while caller and
  command context stay live. No host release or timeout forcing.
- `new-legacy-controlled`: intentionally unenrolled source remains pending
  through a50ms observation; an explicit host-owned gate then releases it without
  aborting caller/source. Return1 and public0 occur after that recorded gate.
  This is a NEW input schedule, not repaired automatic-preemption behavior.
- `new-required-destinations`: stdout consumer closes first; server then supplies
  its normal13-byte body. Actual curl writes `first\nsecond\n` to VFS `/body`,
  HTTP headers to `/headers` and verbose stderr; caller/command/transport remain
  live. Client cleanup/disposal finishes once before public0. This scheduled
  response is normal fixture service work, not failure teardown.
- `new-webdav-body-acquired`: downstream is held until the actual GET reader
  has issued its first read. That read rejects EPIPE and its lock is released
  **before public settlement**. GET reader.cancel/body.cancel calls also settle
  with EPIPE on the already errored stream; they are not falsely reported as
  fulfilled cancels. PROPFIND cancellation counts are separate in the event log.
  Remote GET closes passively before dispose/cleanup; caller/context stay live.
- `new-curl-body-acquired`: downstream is held until the acquired response body
  issues its first read. Exactly one body read, iterator return, response disposal,
  request cleanup and actual ClientRequest close finish before public0. Caller
  and command stay live; transport EPIPE. Remote server notification follows
  public settlement and precedes dispose/cleanup.

## Instrumentation, release actions and limits

v1 source51fb6b40 runs20 observations; v2 source8a674adf runs only the four
body-acquired observations. v2 adds method/request labels and body-stage gates;
it does not overwrite v1's raw observations. Frozen helper/mock TypeScript from
eba is transpiled with recorded compiler hash. Binding-only import changes use
the moved package; the mock's existing resource-identity helper is imported from
that same package's internal file **for test fixture setup**, not as a public API
claim. Original four fixture-input hashes and emitted helper hashes are retained.

Observers add no read/probe payload, but wrap method/promise settlement to record
events, so these are instrumented executions, not a zero-overhead timing proof.
WebDAV fetch readers/cancel/lock release and curl transport cleanup/response body
are independently identified. No unhandled-rejection guarantee is inferred from
observer-added settlement handlers; the earlier unchanged suites cover their
own rejection assertions. All24 runs record zero observer/cleanup errors and no
unhandled notification. These are bounded loopback observations, not arbitrary
server certification or universal host preemption.

Snapshots distinguish at-public-settlement, passive remote-close observation,
before-public-dispose, after-public-dispose, before-harness-cleanup and after
cleanup. The1200ms observation timer **only records pending state**. It aborts
nothing. Four local/cleanup-only runs subsequently need labelled harness caller
abort; their later public rejection and source return are not acceptance rescue.
The two controlled-legacy runs explicitly release their host gate before normal
completion. Other public completions and remote-close observations require no
forced caller abort/server close. Afterward fixture cleanup closes its own server
and idle sockets; this later forcing is recorded, not attributed to product work.
No supervisor kills or active owned children remain. Both protected installation
inventories match pre-run inventories, including unexpected-entry checks.

## Evidence and next decision

`data/SUMMARY.json` separates public-boundary snapshots from cleanup; the
compressed evidence includes every raw event, signal/counter snapshot, process
status, loaded-module hash and both original observer versions. `verify.mjs`
checks payload/file hashes and exact candidate fixture inputs without execution.
`prepare.mjs` creates a fresh installation; `run.mjs` writes only unique OS-temp
outputs. `capture.mjs --capture` is explicit one-time sealing, not canonical test
execution, and refuses replacement.

The first capture invocation stopped before writing evidence because its shell
command text contained the workspace paths and matched its process census.
Standalone capture then passed unchanged; no observer/product process was retried
or resource rescued for that evidence-only setup correction.

`PROPOSAL.md` names the exact proposed fixture write-set and the required profile
decision. **Nothing in that proposal is applied.** No enrolled defect is routed
for a production patch; Poincare's getopts runtime/shell ownership is untouched.
No global typecheck or ledger update here. The original eba13 foreign diagnostics
are historical; root's later regex-only three-diagnostic repair and pending DU
classification are not retrospectively included in this frozen observation.

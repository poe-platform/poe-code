# Cloudflare adapter final artifact review at cf15c987

Decision: **BLOCKED / UNFINISHED**, September 14, 2026. Reviewed main revision
`cf15c987a6306de2e945063caee2d1e8ff6bfa82`. No existing application Worker was
integrated or modified. No push, release, deployment or credential inspection.
The pre-existing modified plan and untracked reports are preserved.

## Current public evidence and reproducible QA

Read root and scoped safe-bash AGENTS.md. Root owns this report, its new capture
and the integration-document update. Independent read-only review is assigned to
`independent_review`; its final acceptance is recorded below before commit.
No other scoped instructions apply to these paths.

[Public API capture](cloudflare-handoff-cf15c987-evidence/public-api.json) has SHA256
`b15abefe4955742a45e71ac9b8adbc6a3f54ab2ddbebab4b54e6541aa7c45ce5`.
It inventories 2,213 source/build/input files with individual SHA256 values.
Node v22.22.2 imported `poe-code/safe-bash` through its public export.
No rebuild ran: these hashes identify observed emitted bytes and source inputs,
not proven correspondence to a clean reproducible build or a runtime closure.

To reproduce the agent-run availability procedure, import the public API, create
`new Shell({fs: new MemoryFileSystem(), env: {}}).use(agentCommands())`, and create
`/hello.py` through shell redirection with `print(42)` contents. Execute inline
python, python3, script with argv, piped stdin and module invocation as listed in
the capture; each must return 127 in this checkout. Then assert
`printf recovered | cat` returns 0 and exact `recovered` bytes/text, await disposal
twice, and compare descriptors for fetch, WebAssembly, SharedArrayBuffer, process
and Worker. These availability/recovery assertions passed; none entered Python.
A default pipeline status alone is insufficient evidence: inspect expected bytes
and each stage, or use pipefail, when qualifying working Python later.

Concrete source inspection finds no `packages/safe-bash/src/commands/python`,
public Python/Pyodide export or injected Python registration in the playground.
The optional product Node command is a different feature; its presence is not a
preserved Node Python baseline. No current transport, integrity/native manifest,
Python admission, Python globals/isolation or Python pending cleanup implementation
exists to fix. Adding regression tests for invented APIs would not resolve this
validated prerequisite. No production code changed or unaffected maintained
package checks reran. Existing Node shell/regex machinery remains untouched.

## Requirement-to-evidence checklist

**Every row below is BLOCKED; zero production passes.** Each is bound to the
current capture's source/build inventory for availability only. Acceptance requires
passing public API evidence for the same complete final source/build/runtime
artifact. Missing, skipped, prototype-only, unit-only and incompatible historical
results cannot count as a pass. None of these requirements has been waived.

| Production contract | Required public acceptance missing from current artifact |
| --- | --- |
| Provider injection/ownership | Built injection and SDK parity; borrowed provider, cleanup before admission, sibling survival and awaited disposal |
| Node compatibility/transport separation | Preserved Python Node baseline and matching argv/script/module/stdin/cwd/env/effects; no Node transport in Worker build |
| Canonical filesystem | Delayed canonical content/metadata and identity/error authority; root/symlink/mount escape rejection, no mirror/copy-back |
| Actual persistence | Actual application backend/emulator unidentified; independent-instance reopen, concurrent/partial writes, flush/close failures, stale metadata, rename/unlink, timeout and quota evidence |
| Streams | Python stdout/stderr bytes, stdin EOF, backpressure, output admission and owned buffers |
| Cancellation/pending cleanup | Initialization/acquisition/output aborts, late replies/handles, exec/dispose barriers; mandatory same-isolate CPU termination remains unqualified |
| Isolation | Globals/modules/env/private state/streams/packages/JS handles and shared-provider sibling canaries |
| Saturation | Bounded admission/queue, rejection latency, failed initialization/retry and recovery |
| Memory | Bounded load/soak and I/O growth, retained handles, WASM/host memory and application responsiveness |
| Supported packages | Exact qualified set is empty; XLSX, DOCX and PDF generation/reopen/large workloads all unqualified |
| Integrity/native manifest | Authenticated pins/assets before execution/inflation; missing/corrupt manifest, corrupt downloads and unsupported-native fail-closed recovery |
| Host globals | Import/init/run/failure/disposal preservation and restricted guest bridge; five unchanged descriptors without Python do not pass |
| Deployment budget | Current upload/static asset sizes, actual account CPU/memory limits and application reserve unidentified |
| Browser public Python | Cold/warm script/module/stdin/pipes/redirection through public registration with bounded startup |
| Browser shared files/artifacts | Python explorer/editor visibility, quota, download hashes and semantic document reopening |
| Browser diagnostics | Unsupported capability/offline/corrupt assets and hosted CSP/MIME/URLs; browser support matrix |
| Browser cancel/reset | CPU loop Stop/timeout, reset/navigation/failure and stale RPC/auxiliary cleanup; browser termination does not qualify Cloudflare |
| Reproducible build | Two identical-input builds with complete normalized asset/hash equality and reproducible upgrade checks |
| Dependencies/licenses | Complete pinned runtime/wheel/native inventory, transitive licenses/notices and redistribution verification |
| Runtime upgrade/rollback | Independently accepted complete pin/artifact sets, upgrade regression and exercised rollback/storage-format compatibility |
| Operational diagnostics | Stable failure classes, safe timing/resource counters and synthetic secret/content canaries with no source/path/data/credential leakage |
| Independent final acceptance | Same executable final artifact and complete passing matrix; independent absence review cannot substitute |

## Evidence classes and deployment status

Historical prototype: the plan reports seven checks, zero retained handles and
5,110.27 KiB gzip at `3f71fdb5-5c5c-46f4-8a14-afec20c25cc7`.
This is a narrow feasibility report, not a currently authenticated adapter build.
Current built public safe-bash: the fresh capture verifies absence/recovery only.
Local workerd: blocked/unperformed because there is no public Python runtime route.
Deployed public adapter: blocked/unperformed; the candidate and authorized external
fixture provenance/guards are absent. Credential expiry and account limits are
unknown, not failed or passed deployment checks.

Browser: prior [Chrome evidence](playground-python-user-recheck-2026-09-14.md)
contains screenshots and Python command-not-found observations against an older
build. Current source has no Python registration. No fresh browser Python
execution, shared file/editor visibility, downloadable document, capability failure
or Stop/reset/navigation acceptance can pass. Shell supervisor termination is not
in-process Cloudflare CPU-loop cancellation. No visual changes were made.

Actual persistent storage is explicitly **unqualified**: the application's backend,
emulated integration route and consistency/durability contract are unidentified.
MemoryFileSystem and generic safe-fs adapters are not substitutes. XLSX, DOCX and
PDF document families are explicitly **unqualified**; the exact qualified Pyodide
package set is **empty**. Current deployment bytes, memory/CPU and application
headroom remain unmeasured. JSPI suspension supplies no independent CPU preemption;
the mandatory lifecycle feasibility gate remains unresolved.

## Build, operational and resumption gates

[Integration documentation](../integrations/cloudflare-safe-bash-python.md)
documents intended caller-owned embedding without inventing an available API,
static/generated assets, canonical authority, cancellation limits, deployment-size
gaps, reproducible build checks, full dependency/license inventory, runtime pin
upgrade/rollback and sanitized diagnostics. Those checks are procedures, not passes.
Follow the maintained selected workspace build/public-consumer routes only after
candidate admission; compare two builds from identical clean inputs and record
complete asset/dependency/license hashes. Retain and independently accept the
complete prior artifact before upgrade or rollback; there is currently no accepted
artifact. Use synthetic content/secret canaries to qualify diagnostics without
logging user source, paths, environment, credentials or raw exceptions.

First precise blocker: an available public injected Pyodide executor with the
original Node Python baseline and a feasible passing mandatory lifecycle contract.
Additional independent blockers: actual application backend qualification,
authenticated runtime/package/native assets and account/application headroom.
Return validated code findings to an assigned implementer for failing focused
regressions before fixes, then run only affected maintained checks. Independent
review must examine the same complete passing final runtime artifact. An absence
review can confirm blockers, not certify production readiness.

No plan task is marked complete by this review. The pre-existing plan has conflicting
historical status prose; its done entries cannot count as verified acceptance.
Compatibility/handoff and finalization remain unfinished. Local delivery is recorded
in the final response after the documentation commit. Remote-main delivery and
release were not attempted.

# Current public adapter user edge review

Status: **BLOCKED / UNFINISHED; zero production contracts pass**.
Reviewed HEAD `937588145` on September 14, 2026. Root owns this report,
its new evidence directory and the integration status update only. Existing
modified plan and untracked reports remain untouched. No package code changed.

## Executed user procedure and artifact identity

Import built `poe-code/safe-bash`; construct `Shell` with `MemoryFileSystem`,
empty environment and `agentCommands()`. Run ordinary unchanged Python source
through python/python3 inline, a virtual `.py` file with a spaced argument,
piped stdin, `-m json.tool`, a virtual `.sh` script and output redirection.
All seven public routes return 127. Then run `||` recovery, sequential shell
recovery, two overlapping Python calls, and `printf recovered | cat`.
Recovery returns exact expected bytes and status 0; overlapping Python calls
return 127. Await disposal twice. Compare five host global descriptors.
All absence/recovery assertions passed; **Python never executed**.
Redirection command absence does not establish Python file persistence.
Descriptor preservation without Python does not establish interpreter isolation.

[Public capture](cloudflare-user-edge-review-937588145/public-api.json)
SHA256 `0a9a0a4fb0a1cc5d42e1b9d8ea819d9d8b777b5dbebe6d2c0c4c855fd99d9cf1`
contains Node version, full HEAD, exact inputs/results, and SHA256 for 2,372
observed source/build/input files. It is an observed artifact inventory, not
proof of reproducible source-to-build correspondence or a complete dependency
closure. No rebuild was performed. Public Python exports are absent; Python
command directory, `src/sdk/bash.ts`, external validation provenance and guarded
deployment script all return ENOENT.

## Requirement-to-evidence checklist

Every row below references the same hash-bound public capture. Every row is
**BLOCKED**, with no passing production evidence. Missing implementation,
skipped cases, ordinary shell behavior and historical prototypes cannot pass.

| Required contract | Missing public acceptance |
| --- | --- |
| Provider injection and ownership | Injected Python executor, SDK parity, borrowed-provider sibling survival and cleanup before acquisition |
| Node compatibility and transport separation | Original Python Node baseline; identical argv/script/module/stdin/cwd/env/effects and Node-free Worker transport |
| Canonical filesystem authority | Actual asynchronous content/metadata, identity/error fidelity, delayed I/O, symlink/mount confinement without mirror/copy-back |
| Actual persistent storage | Identified application backend, fresh-instance reopen, concurrent/partial writes, flush failure, stale metadata, rename/unlink, quota and timeout |
| Streams | Python byte stdout/stderr, EOF, backpressure, output admission and retained buffer ownership |
| Cancellation and pending operations | Pre-admission/init/I/O aborts, late handles/replies, cleanup barriers and mandatory same-isolate CPU termination |
| Isolation | Python globals/modules/env/private state/streams/packages/JS handles and concurrent sibling canaries |
| Saturation | Bounded queue/admission, rejection latency, failed initialization/retry and recovery |
| Memory | Bounded load/soak, retained handle census, WASM/host growth and application responsiveness |
| Supported packages | Exact qualified set is empty; XLSX, DOCX and PDF generation/reopen/large workloads unqualified |
| Integrity and native manifest | Authenticated pins/assets before execution/inflation; corrupt/missing assets/manifests and unknown native modules fail closed with recovery |
| Host globals | Preservation during Python import/init/run/error/disposal and restricted guest bridge |
| Deployment budget | Current upload/static assets, account limits, CPU/memory and existing application reserve |
| Browser public execution | Cold/warm Python script/module/stdin/pipes/redirection with bounded initialization |
| Browser shared files and downloads | Python explorer/editor visibility, quotas, artifact hashes and semantic document reopening |
| Browser capability diagnostics | Unsupported browser/offline/corrupt assets, actual hosted CSP/MIME/URLs and browser matrix |
| Browser cancellation and reset | CPU Stop/timeout, reset/navigation/failure, stale RPC and auxiliary-resource cleanup |
| Reproducible build and upgrade | Identical-input double builds, normalized asset equality and complete toolchain/input hashes |
| Dependency and license inventory | Pinned runtime/wheels/native dependencies, transitive licenses/notices and redistribution verification |
| Runtime pin upgrade and rollback | Accepted complete artifact sets, exercised upgrade/rollback and persisted-format compatibility |
| Operational diagnostics | Safe stable failure classes/timing/resource counts and synthetic secret/content canaries |
| Independent final acceptance | Independent same-artifact review plus complete passing production matrix; absence review is insufficient |

## Evidence classes, maintenance and resumption

Historical prototype: version `3f71fdb5-5c5c-46f4-8a14-afec20c25cc7`
reported seven narrow checks and 5,110.27 KiB gzip. This is not a current public
adapter or current deployment-size measurement; original provenance is absent.
Current public safe-bash: fresh absence/recovery evidence above only.
Local workerd: adapter/runtime unavailable; blocked and unperformed.
Deployed: provenance/guard unavailable; blocked and unperformed. Credentials
were not inspected; availability and expiry are unknown. No Cloudflare API
operation occurred. No existing application Worker was integrated or modified.
Browser: [prior real-browser evidence](playground-python-user-recheck-2026-09-14.md)
remains historical shell/command-absence evidence. No fresh browser acceptance
or screenshot was run; there is no visual change. Python execution, visible
shared files, downloadable document artifacts, diagnostics and cancel/reset
remain unqualified.

The previously executed maintained build/typecheck success and unit failures
in [request validation](cloudflare-adapter-request-validation-20260914.md)
remain historical and unresolved; this review does not count them as a passing
current gate. No runtime code changed, so no workspace unit/build rerun is
warranted for this documentation-only update. Public assertions and documentation
link/hash/whitespace validation cover the changed scope. No regression fixture
can validate Python lifecycle through absent code; no invented adapter or weakened
checks were introduced.

Follow the [integration contract and build/upgrade/rollback procedures](../integrations/cloudflare-safe-bash-python.md),
[public runtime QA](cloudflare-integrated-adapter-qa.md),
[actual backend/load qualification](pyodide-cloudflare-production-qualification.md)
and [browser QA](safe-bash-playground-python-qa.md) after prerequisites arrive.
Freeze source/build/lock/toolchain/runtime/asset inputs, declare bounded workloads,
run affected maintained checks, preserve failures and independently review the
same final artifact after fixes. Procedures are required future work, not passes.

First blocking requirement: a public injected Pyodide executor and preserved
Python Node implementation are absent. Independent additional blockers include
mandatory lifecycle feasibility, unidentified actual persistent backend, package
and document qualification, deployment provenance and application budget.
Plan done labels conflict with observed absence; the pre-existing modified plan
is preserved and not certified. Pipeline and finalization remain unfinished.
No push, remote-main verification or release occurred.

## Independent same-artifact result and local validation

The [independent review record](cloudflare-user-edge-review-937588145/independent-review.json)
records read-only verification by `/root/independent_review`: the capture hash
matches, all 2,372 regular files rehash correctly, zero mismatches. Independent
public calls reproduce absence/recovery, concurrent attempted CPU-loop/native
imports return 127, and a Python subpath import is not exported. Empty Node
provider options fail with TypeError rather than an ambient/native fallback;
this restricted Node admission is not Python-on-Node compatibility acceptance.
The reviewer concludes BLOCKED with zero Python production passes.
Root additionally verified capture/input hashes, all changed-document local
links and `git diff --check`. No product, README or pre-existing plan edits.
This documentation improvement is prepared as one local commit; remote delivery
and release remain unattempted.

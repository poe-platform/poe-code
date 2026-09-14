# Cloudflare adapter current handoff and agent-executed QA

Decision: **BLOCKED / UNFINISHED**. Source HEAD
`51ea26d96f61b74ffb0ef70aeaef48d5cc423d4e`, Node v22.22.2.
No Python adapter exists in the current package source or public exports.
Root read root and scoped safe-bash instructions; independent read-only package
review completed through `independent_review`. Root owns this report, its new
evidence directory and the two integration/review documentation updates only.
The pre-existing modified plan and untracked evidence are preserved.

## Executed public-API procedure and evidence

Import the existing built `poe-code/safe-bash` API. Construct
`new Shell({fs: new MemoryFileSystem(), env: {}}).use(agentCommands())`.
Execute inline python/python3, an ordinary VFS script with argv, piped stdin
and module invocation; assert each returns 127. Then execute
`printf recovered | cat`, assert status 0 and exact output, and await disposal
twice. Compare descriptors for fetch, WebAssembly, SharedArrayBuffer, process
and Worker before/after. These assertions passed as **absence/recovery checks**;
they never entered Python and do not qualify lifecycle or host isolation.

[Public capture](cloudflare-adapter-handoff-current-evidence/public-api.json)
SHA256: `dfac77013e2d7fc382a7289a62ed636026254511d5f3f7895f5f3fe62344bbde`.
It inventories 2,324 source/build/input entries, including all observed safe-bash
source/dist, safe-fs dist and playground source/site bytes. No rebuild ran.
This identifies the observed artifact; it does not authenticate its complete
runtime dependency closure or prove correspondence to a reproducible clean build.
Missing paths include Python commands, `src/sdk/bash.ts` and the authorized
external deployment provenance/guard scripts. No Pyodide export was found.
The [independent review record](cloudflare-adapter-handoff-current-evidence/independent-review.json)
confirms the same capture hash, all 2,324 matching entries with zero mismatches,
four absent prerequisites and independently reproduced public absence/recovery.
It concludes BLOCKED / UNFINISHED with zero production passes.

## Requirement-to-evidence checklist

Every row is required and **BLOCKED**, with zero production passes. All refer to
the current capture above and its source/build hashes. Absence assertions,
unit-only results, skipped checks, older artifacts and prototypes cannot pass.
The [full earlier matrix](cloudflare-adapter-final-review.md) supplies detailed
failure scenarios; none has been waived or reduced.

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

## Evidence classes and reproducible resumption

Historical prototype: seven reported narrow passes at
`3f71fdb5-5c5c-46f4-8a14-afec20c25cc7`, 5,110.27 KiB gzip; original external
provenance is absent. This is not current public safe-bash evidence.
Current public safe-bash: fresh command-not-found and shell recovery above.
Local workerd: public Python route/runtime absent, blocked and unperformed.
Deployed adapter: candidate and provenance/guards absent, blocked and unperformed;
credential expiry and deployed settings are unknown, with no credential inspection.
Existing application Worker integration: explicitly unperformed; no mutation
of application Workers, routes, bindings or resources is authorized here.

Browser: prior [Chrome QA and screenshots](playground-python-user-recheck-2026-09-14.md)
show command absence and working shell/regex, not Python acceptance. Python shared
files/downloads/cancellation/reset/capability diagnostics remain unqualified.
No visual product change was made in this review, so no fresh screenshot claim
is made. Earlier maintained build/type success and unit failures remain historical
in [integrated QA](cloudflare-integrated-adapter-qa.md); they were not rerun or
represented as a passing gate. No package code changed or code defect in an
available adapter could be reproduced; inventing tests for absent code would
not resolve this prerequisite. Only public absence assertions and documentation
integrity checks apply to this documentation change.

Resume only after candidate admission and the achievable mandatory lifecycle
gate. Follow [integration build/upgrade/rollback and diagnostics procedures](../integrations/cloudflare-safe-bash-python.md),
[manual public-runtime QA](cloudflare-integrated-adapter-qa.md),
[actual-backend/load QA](pyodide-cloudflare-production-qualification.md) and
[real-browser QA](safe-bash-playground-python-qa.md). Declare bounded workloads
and repetitions before execution, freeze source/toolchain/lock/pins/input hashes,
run only affected maintained checks, and independently review the same complete
final artifact after fixes. These procedures are documented, not executed passes.

First blocker: missing public injected Pyodide executor and preserved Python Node
implementation. Additional independent blockers are the unidentified actual
persistent backend, mandatory lifecycle feasibility, runtime/package qualification,
application budget and deployment provenance. The pipeline task and finalization
remain unfinished; pre-existing plan bytes and unsupported done claims are not
certified by this review. Local documentation commit is reported after hooks pass.
Remote-main delivery and release: not attempted; no push or release.

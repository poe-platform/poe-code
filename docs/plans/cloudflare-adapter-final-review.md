# Cloudflare safe-bash final compatibility and handoff review

Current acceptance is recorded in [the current handoff review](cloudflare-adapter-handoff-current.md).
This report's captures remain historical; its requirement checklist has no
passing production rows and is not certification of the current artifact.

Status: **BLOCKED / UNFINISHED**, September 14, 2026. Reviewed source HEAD
`becb83f24556eb6df7747e916408a00cc043be83` on main. Root owns this new report,
`docs/integrations/cloudflare-safe-bash-python.md` and the new final-review
capture directory only. Preserve the pre-existing modified pipeline and all
other untracked evidence. No production code or README changes, remote mutation,
push or release are authorized or performed.

## Validated prerequisite and evidence classes

Root independently inspected root/scoped AGENTS.md, public source/manifests,
playground transport/registration/build and existing QA. Required independent
read-only review is assigned to `adapter_review`; its final hash-bound report
will accompany this checklist. No additional scoped instructions apply to the
new documentation paths. No package edits were made because the requested
candidate is absent, rather than a validated fixable adapter defect.

Fresh public execution uses Node v22.22.2 and the declared built
`poe-code/safe-bash` API, `new Shell({fs: new MemoryFileSystem(), env:{}})`
and `.use(agentCommands())`. Inline Python, python3, ordinary script/argv, stdin
pipeline and module invocation all return 127. Recovery `printf recovered | cat`
returns 0 and exact bytes/text `recovered`; repeated awaited disposal completes.
No Python/Pyodide export is present. Five host-global descriptors are unchanged.
These assertions pass only as availability/recovery observations; **zero
production rows pass**. The hash inventory and result records are in
[current-public-api.json](cloudflare-adapter-final-review-evidence/current-public-api.json).
It hashes inspected source, package/lock inputs and available build entries;
it is a partial inventory, not a complete authenticated runtime/build closure.
An attempted `src/plugins/agent.ts` inventory entry is ENOENT and supplies no
source evidence. No adapter source/build hashes exist to bind acceptance to.

Evidence classes must remain separate:

- Historical prototype: plan reports seven narrow checks at deployed version
  `3f71fdb5-5c5c-46f4-8a14-afec20c25cc7`, zero handles and 5,110.27 KiB gzip.
  Original fixture/provenance is absent here; these are historical reported
  observations, not reverified public safe-bash results.
- Current public safe-bash: the fresh capture above verifies missing registration.
  Prior [integrated QA](cloudflare-integrated-adapter-qa.md) records maintained
  build/public-type success but unit failure (23 failed, 86 skipped); this is not
  a passing full local gate. These historical captures were not rerun or altered.
- Browser: [real Chrome recheck](playground-python-user-recheck-2026-09-14.md)
  records built-site Python command-not-found, shell/regex recovery, screenshots
  and measured JSPI availability in Chrome 152.0.7977.84. Its 223 unit passes and
  successful build do not prove any Python contract. It identifies an older
  source revision and is not a final Python artifact certification.
- Local workerd: no public Python runtime route or installed runtime identified;
  execution unperformed/blocked. Deployed public adapter: blocked by missing
  candidate and absent external provenance/guards. No deployment checks ran;
  credentials and account settings were not inspected.

## Requirement-to-evidence checklist

Every required row needs passing public-API results against the same complete
source/build/runtime hash inventory. Missing, skipped, unit-only, prototype-only
or older incompatible artifact evidence does not pass. `A` below denotes the
fresh hash-bound availability capture; it demonstrates absence, not acceptance.

| Required production contract | Current evidence and precise missing acceptance | Status |
| --- | --- | --- |
| Provider injection, admission and ownership | A: no Python export; public injected provider signature, borrowed ownership, disposal/sibling behavior unavailable | BLOCKED |
| Transport separation and preserved Node compatibility | No Python Node baseline or JSPI implementation; identical script/module/stdin/argv/cwd/env/output/effect comparison and Node asset exclusion absent | BLOCKED |
| Canonical filesystem authority | No Python bridge; public delayed canonical content/metadata, symlink/mount/root authority and no mirror/copy-back evidence | BLOCKED |
| Actual persistent storage | Actual application backend/emulator unidentified; durable reopen across independent instances, concurrent/partial writes, flush/close, stale metadata, timeout, rename/unlink and quotas unqualified | BLOCKED |
| Streams and bounded output | A pipeline never enters Python; stdout/stderr byte identity, EOF, backpressure, owned buffers and limit admission untested | BLOCKED |
| Cancellation, pending operations and cleanup | No executor; before/during initialization/open/output cancellation, late descriptors, cleanup-before-acquisition and awaited exec/dispose barriers untested; JSPI CPU preemption unqualified | BLOCKED |
| Python state and authority isolation | Globals/modules/env/private files/package capabilities/JS handles/streams canaries, fresh instances and shared-provider sibling failure tests absent | BLOCKED |
| Saturation and recovery | No admission implementation; bounded concurrency/queue, rejection latency, retirement, failed initialization/retry evidence absent | BLOCKED |
| Memory and responsiveness | No load/runtime observations or application route/headroom; WASM versus host/isolate measurement and allocation/memory growth limits unqualified | BLOCKED |
| Supported packages and document families | Qualified package set empty; XLSX/DOCX/PDF generation, reopen, host inspection and large workloads unqualified | BLOCKED |
| Integrity and native-manifest failure | No pins/assets/manifest; authenticate before evaluation/inflation, corrupt/missing/unsupported native rejection and recovery untested | BLOCKED |
| Host-global preservation and guest capability boundary | A preserves five descriptors without Python; interpreter import/init/execution/failure/disposal snapshots and host bridge access restrictions untested | BLOCKED |
| Deployment size/account and application budget | Only historical prototype gzip figure; current raw/compressed upload/static asset size, CPU/memory limits, application reserve and responsiveness absent | BLOCKED |
| Browser public Python execution | Prior Chrome and A return 127; cold/warm public script/module/stdin/pipeline/redirection, lazy bounded startup and SDK parity absent | BLOCKED |
| Browser visible shared files and downloadable artifacts | Shell-only writes observed historically; Python explorer/editor roundtrip, workspace quotas, document download/semantic inspection/hash absent | BLOCKED |
| Browser capability and asset diagnostics | JSPI available in one Chrome baseline; actionable unsupported/offline/corrupt asset behavior, Firefox/WebKit, hosted CSP/MIME/URLs unqualified | BLOCKED |
| Browser cancellation/reset/navigation | Python Stop/timeout/CPU loop, reset while busy, pending RPC/auxiliary cleanup and rejection of late replies unqualified; browser termination cannot certify Cloudflare | BLOCKED |
| Reproducible build and dependency/license inventory | No complete adapter asset/SBOM/license inventory or repeat-build hash equality; available package/build hashes only identify missing-feature artifact | BLOCKED |
| Runtime pin upgrade and rollback | No accepted pinned artifact; upgrade compatibility/rebuild/review and complete artifact rollback/smoke unexercised | BLOCKED |
| Operational diagnostics without user data | No runtime telemetry; stable error classes, content/secret canary exclusion, safe counters and ambiguity/recovery evidence absent | BLOCKED |
| Independent review of same final artifact | Independent absence review can verify blockers; no executable final production artifact or complete passing matrix exists | BLOCKED |

## Dependency and license inventory

[Declaration inventory](cloudflare-adapter-final-review-evidence/dependency-inventory.json)
records current workspace versions/dependencies and selected lockfile license
metadata for `@noble/hashes`, `pako` and `@jspm/core`. Safe-bash, safe-fs and
playground manifests do not declare a license field; root declares MIT. This
is not a legal conclusion about their licensing or redistribution clearance.
No Pyodide/CPython/wheel/native-asset inventory exists. Complete transitive
licenses/notices and runtime asset hashes remain blocking requirements.

## Reproducible resumption and handoff

[Integration boundaries and build/upgrade/rollback procedure](../integrations/cloudflare-safe-bash-python.md)
describe the intended embedding, exact empty qualified package set, static assets,
canonical filesystem, actual cancellation limits, deployment-size gap and safe
diagnostics. These are explicit unperformed requirements, not invented public
Python APIs. Follow [manual integrated QA](cloudflare-integrated-adapter-qa.md),
[backend/load qualification](pyodide-cloudflare-production-qualification.md) and
[manual browser QA](safe-bash-playground-python-qa.md) after candidate admission.

The first blocking requirement is an available public injected Pyodide executor
with its preserved original Node API and an achievable passing lifecycle gate.
Also required: actual application storage wiring/emulator and consistency contract,
qualified runtime/package assets, account/application budget and admissible local
and deployment provenance. No existing application Worker mutation is authorized.
Do not select a convenient substitute backend or relabel a smaller experimental
contract as production-ready.

Prior pipeline `done` statuses are not verified production completion. They do
not match this checkout's evidence and cannot certify missing prerequisites.
This review does not modify the pre-existing plan; compatibility/handoff
implementation/test and finalization must remain open until every required row
passes. No code regression tests were added for absent code, and no unaffected
maintained package checks reran for this documentation-only review. Fresh public
availability assertions and documentation/evidence integrity checks are the
only current validations. Existing unrelated unit failures remain recorded,
without claiming that a local gate passed.

Local delivery: documentation-only; the local commit is identified in Git history
and the delivery response after verification. It does not complete production acceptance.
Remote-main delivery: not attempted. Release/publication: not attempted.
The production pipeline remains unfinished.

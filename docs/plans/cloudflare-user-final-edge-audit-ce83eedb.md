# Public Cloudflare Python user edge audit

Status: **BLOCKED / UNFINISHED**. September 14, 2026. Inspected source HEAD
`ce83eedb79b7a062cc45fe7e6a458b127468fbf8`, Node v22.22.2. Root/scoped
AGENTS.md and the parent plan apply. Root owns this new report, its new evidence
directory and the integration documentation update only. Preserve the pre-existing
modified parent plan and all untracked reports. No application Worker mutation,
push or release is performed.

## Executed user scenarios

[Fresh public-API evidence](cloudflare-user-final-edge-audit-ce83eedb/public-api.json)
records source/build/lock hashes and 15 scenarios through the installed built
`poe-code/safe-bash` API. Create `new Shell({fs: new MemoryFileSystem(),env:{}})`,
register `agentCommands()`, run the literal recorded inputs in order, and await
`dispose()` twice. Files exist only in the memory filesystem; JSON is an explicit
QA capture, not a new QA script or unit test. No runtime package installation occurs.

Inline python/python3, a real virtual script with arguments, stdin, module,
missing script, help, redirection and CPU-loop source all encounter command absence.
The CPU-loop source never executes and supplies **no cancellation evidence**.
Shell recovery returns exact `recovered`; the virtual script remains readable;
redirection creates an empty file before command lookup fails. Five host-global
property descriptors remain equal and repeated awaited disposal settles.
These are bounded availability/recovery observations, not Python acceptance.

A default `python -c "print(1)" | cat` returns 0 with command-not-found stderr:
last-stage pipeline status can hide missing Python. `PIPESTATUS` exposes 127
for the first stage; enabling `set -o pipefail` returns 127. Acceptance must check
expected output bytes and stage failures, not only aggregate exit status. This is
expected shell behavior, not a validated adapter bug. No code was changed and
no regression test was invented for an absent implementation.

Public exports contain no Python/Pyodide entry. Required
`packages/safe-bash/src/commands/python` and `src/sdk/bash.ts` are absent.
`pyodide`, `wrangler` and `workerd` resolve MODULE_NOT_FOUND; the referenced
external validation document is absent. The available `workerd` shell export is
not a Python execution transport. The separate safe-python interpreter and AI
Gateway provider do not qualify the requested fixed Pyodide runtime.

## Requirement-to-evidence checklist

Every production row requires passing public-API evidence for the same final
source, complete build closure, runtime/manifest/pins and inputs. This capture
hashes selected existing files only; it does not establish a reproducible build
or authenticated runtime closure. **Zero production rows pass.** Missing, skipped,
prototype-only and unit-only results cannot count as passing production evidence.

| Required contract | Current result / missing acceptance | Status |
| --- | --- | --- |
| Injected provider, ownership and disposal | No public provider; borrowed/shared shells, sibling survival and owned retirement unavailable | BLOCKED |
| Transport separation and preserved Python Node compatibility | Python Node baseline and JSPI implementation absent; compare script/module/argv/stdin/cwd/env/output and existing createWorker behavior after admission | BLOCKED |
| Canonical filesystem authority | Memory shell reads/writes work; no Python async service proving content/metadata/error/identity forwarding without MEMFS copy-back | BLOCKED |
| Actual persistence | Playground constructs quota-wrapped memory storage; actual application backend, durability contract and emulator unknown | BLOCKED |
| Streams and pending-operation cleanup | No Python byte-stream/backpressure/order, pending acquisition, exactly-once descriptor close or awaited cleanup evidence | BLOCKED |
| Cancellation | Command absence only; JSPI I/O suspension cannot alone stop same-isolate CPU loops; mandatory termination remains a feasibility blocker | BLOCKED |
| Python isolation | No adversarial globals/modules/builtins/environment/private-file/descriptor/JS-handle tests on an interpreter | BLOCKED |
| Admission and saturation | No limits, pipeline deadlock, saturation refusal or capacity retirement evidence | BLOCKED |
| Memory | No cold/warm/document/load growth or retained runtime measurements; library quotas do not prove isolate/RSS limits | BLOCKED |
| Supported packages and documents | Exact qualified Python set empty; XLSX, DOCX and PDF generation/reopening unqualified | BLOCKED |
| Integrity and native manifest | No pinned authenticated runtime assets, allowlist or missing/corrupt/unknown-native fail-closed recovery | BLOCKED |
| Host globals | Descriptor preservation during command absence passes as an observation only; runtime load/execution/failure preservation missing | BLOCKED |
| Deployment budget | Current adapter size and application upload/memory/CPU reserve unknown | BLOCKED |
| Browser Python and diagnostics | Public execution and truthful capability diagnostics unavailable; no final runtime browser evidence | BLOCKED |
| Browser shared files and downloads | Shell memory files are not Python editor visibility or qualified downloadable document evidence | BLOCKED |
| Browser cancellation/reset | No Python Stop/timeout/reset, delayed-reply, navigation or CPU-loop evidence | BLOCKED |
| Build and upgrade reproducibility | Complete deterministic build inventories, pin upgrade and exercised rollback missing | BLOCKED |
| Dependency/license inventory | No Pyodide/CPython/wheel/native closure or redistribution notices; empty qualified set is not a completed license audit | BLOCKED |
| Operational diagnostics | No runtime failure taxonomy, pending counters or synthetic-secret redaction evidence | BLOCKED |
| Independent final review | Independent read-only review completed for the same source/build files; absence review cannot certify a nonexistent adapter | BLOCKED |

Independent reviewer `/root/independent_review` confirmed the same built entry hashes
and availability failures; [review record](cloudflare-user-final-edge-audit-ce83eedb/independent-review.json)
records bounded checks and source/build identifiers. Missing/invalid opt-in Node
providers reject synchronously; this does not establish preserved Python Node behavior.

## Evidence boundaries and resumption

Historical prototype: reported seven narrow deployed checks, zero handles and
5,110.27 KiB gzip at version `3f71fdb5-5c5c-46f4-8a14-afec20c25cc7`;
not reexecuted or bound to current public safe-bash. Current public safe-bash:
fresh availability/recovery capture above. Local workerd: blocked by missing
candidate/runtime. Deployed adapter: blocked and unperformed; no credentials,
account settings, routes, bindings or application Worker were inspected or changed.
Historical browser screenshots remain historical command-absence evidence;
no new browser/screenshot validation or Python browser pass is claimed.

Follow [integration and build/upgrade/rollback procedures](../integrations/cloudflare-safe-bash-python.md),
[manual integrated QA](cloudflare-integrated-adapter-qa.md),
[actual-backend/load qualification](pyodide-cloudflare-production-qualification.md)
and [browser QA](safe-bash-playground-python-qa.md) after admission. These are
reproducible instructions to execute, not executed passes. Freeze the complete
artifact/pins/lock/toolchain/input hashes, declare bounds and headroom, verify
all public contracts, fix reproduced defects with failing tests first, run only
affected maintained checks, and independently review the same final artifact.
Use sanitized phase/status/count/timing/build metrics; canaries must prove no
source, file data/paths, environment, credentials or raw host errors leak.

First blocker: unavailable injected Pyodide executor and preserved Python Node
implementation. Additional required blockers: achievable mandatory same-isolate
lifecycle, actual persistence, runtime/package integrity and licensing, browser
acceptance and application/deployment budget. Do not substitute a backend or
weaker experimental contract. Existing conflicting plan done states are not
certified and were preserved as unrelated changes. Finalization stays pending.

Delivery: only this documentation/evidence improvement is eligible for a local
atomic commit. No maintained package build/unit rerun is warranted without a code
change; fresh public probes and documentation integrity checks validate this audit.
Remote-main delivery and release are unattempted. Report the local commit hash
separately after hooks complete.

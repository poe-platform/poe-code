# B8 Successor Executor Protocol

Status: Accepted interface; implementation in progress, no dynamic conformance claim

Implemented Through: Not applicable

Purpose: Define the sealed worker ABI, observable one-clock supervision and strict candidate admission for the root-authorized finite successor cohort.

## Normative Language
The words MUST, MUST NOT and MAY identify mandatory behavior and explicit options.

## Problem and Scope
The core MUST coordinate exactly336 outer slots under24165000ms, without retry/reset. It MUST NOT import or execute candidate code during this preparation. The boundary includes trusted harness, explicitly copied tools, authenticated candidate and unique evidence. Host JavaScript is not an OS sandbox.

## Domain Model and Configuration
CORE-INTERFACE.json is the exact machine-readable ABI. Each slot retains its stable frozen ID, role, environment and obligations. RootGO MUST bind the independent expected receipt hash, complete recipe/tool/source/package manifests and candidate b8f5d60d75452e1dd181167fb87abd995221f6e3. Missing authorization MUST deny before candidate import or process admission. Historical v1 FINAL-SEAL content MAY be referenced as ORIGINAL_MODE_UNATTESTED only; it MUST NOT control executable authority or contribute an invented mode.

## State Machine
One supervisor records immutable monotonic origin before authorization. Phase and slot deadlines MUST be the minimum of global, cumulative phase cutoff, actual phase start plus phase cap and slot reservation plus slot cap. Setup/admission/operation/capture/cleanup/complete events MUST be acknowledged and stamped by the parent before advancement. Startup and import belong to setup/admission, not measured command execution. Operation starts before command/compiler admission; cleanup stays inside the slot. Supervisor enforces deadlines independently of blocked coordinator/worker JavaScript. Remaining-budget refusal is UNRUN, never product failure. Phase allocations are ceilings, not predicted duration.

## Worker and Tool Contracts
Workers export runWorker(api) without top-level candidate effects. Workers MUST NOT spawn children. Only the supervisor may spawn one outer and one nested tool, each with known PID/group, fixed executable/argv and sanitized environment. Git selected objects and compiler configs MUST be independently bound before spawn. A compiler's declared negative diagnostic MAY be classified inside a zero-exit worker; worker/parent nonzero, signal and timeout MUST always make aggregate FAIL. Expected stdout PASS cannot waive process failure.

## Capture and Integrity
The parent MUST spool raw stdout/stderr before parsing or assertions. Candidate byte/status/rejection/effect/event capture MUST be durable before projection assertions. Scoped rejection identities stay in one child. All source/package/recipe/tools/materializations MUST pass fresh membership, added-entry, mode, kind, size and hash checks before and after each admission, including retained moved roots. No ambient NODE_PATH, workspace modules, shell or network is admitted. Installed-unmoved is not a third149-job semantic environment. Type/data/source/admission/control receipts MUST NOT inflate semantic counts. Unknown obligations remain INCOMPLETE/UNRUN.

## Failure and Recovery
Ordinary safe assertions MAY continue only after positive integrity and known reap. Unsafe provenance, admission, loader, integrity or unknown reap MUST stop admissions. TERM/KILL and known-group absence MUST be bounded inside existing cleanup reservation; no arbitrary PID scans or foreign kills. The protocol makes no opaque-host preemption or escaped descendant proof. Raw overflow MUST preserve the bounded prefix and explicit failure, never silently truncate. Duplicate/missing/malformed receipt/events MUST NOT green a job. There are no retries or resumes.

## Validation Matrix
Static preparation checks MUST inspect syntax, source/diff hashes, finite algebra and exact frozen projections without executing workers, loader, predicates, compiler or product. A different reviewer later needs controls for nonzero-after-PASS, safe failure continuation, before-assert capture, mutation/added-entry/mode STOP, timeout/reap gating, receipt corruption, phase overflow, tool ownership, loader path denial and actual loaded mutants. These dynamic obligations remain UNRUN until separately authorized. Conformance is not established by this interface seal.

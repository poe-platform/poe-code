# B8 TYPE and LOADED Worker Component

Status: Proposed component binding; sealed for independent review, no execution GO

Implemented Through: Not applicable; executable bodies require future dynamic verification

Purpose: Define concrete leaf workers under the committed core v1 ABI without granting execution authority or changing the frozen workload.

## Normative Language
MUST, MUST NOT and MAY identify required behavior, prohibitions and explicit options.

## Scope and Authority
The component owns only `workers/**`. Core interface commit `9d582d791336fd66d865f6592b830c39a359d344`, SHA256 `c5e36798741667981f21f002755be3f420fbd6103b8a4b3f8783531a9f6fc412`, defines methods and lifecycle. Each entry MUST export `async runWorker(api)`; neither has a CLI or top-level effects. Core MUST authenticate fresh RootGO, complete recipe, selected-source origins, tools, candidate and mutant enrollment before importing active worker code. API objects are trusted in-process capabilities, not a JavaScript sandbox or independently verifiable signature.

Candidate is exactly `b8f5d60d75452e1dd181167fb87abd995221f6e3`. Selection MUST remain baseline5137 plus acceptedlength7436 plus authorized new YQ/query-core blobs, not global candidate tree/HEAD. Old35da outcomes and author9/26/19 counts MUST NOT enter new success totals. Source/archive/package maps retain271/273/870 and exact baseline README. Historical reference mode is ORIGINAL_MODE_UNATTESTED; fresh active projections MUST have strict path/kind/mode/size/hash admission. No policy or original v1 mode-denial waiver is supplied.

## Domain Model and Configuration
`TYPE-PLAN.json` and `MUTANT-PLAN.json` are exact bodies for `readBoundJson('typePlan'|'mutantPlan')`. Worker-local projection bytes MUST equal these core-bound bodies. `INPUTS.json` records immutable provenance. Four `maps/*.json` provide complete870 maps, not just deltas; canonical map SHA recursively sorts keys and omits trailing newline. Eleven `.mts.data` fixtures retain original bytes. No historical executable helper is imported.

`RESULT-SCHEMA.json` specifies required fields inside core v1's otherwise opaque result/binding objects. This is an explicit integration requirement, NOT a claim that current core bodies already implement these shapes. Core owner MUST bind or normalize these fields in a committed, reviewed implementation before root may close the recipe. Missing evidence MUST fail closed; workers MUST NOT substitute live imports, tool execution, guesses or receipt self-authority. No new core API method is introduced.

## TYPE Contract
TYPE-SOURCE-DIRECT-SIX and TYPE-DIRECT-SIX MUST each invoke six distinct compiler requests, in the declared order, using a fresh same-profile materialization. Declarations are authenticated `.d.ts` files, with `.js` specifiers required by NodeNext; `allowJs:false` and a single explicit fixture prevent JS/source checking. Source-build equality is not a replacement for either six-call set.

Compiler MUST be core-owned copied Node22.22.2 and TS5.9.3, with strict copied @types/node and undici-types trees, explicit cwd/argv/config/typeRoots. Only copied dependency node_modules is allowed; ambient/workspace/NODE_PATH/NODE_OPTIONS fallback is forbidden. Core MUST independently guard the whole tool manifest and resolution closure, not merely accept worker metadata. Scratch generation is bounded, exclusive and outside candidate/recipe/workspace; generated files are retained and registered through core notes before tool admission, never broad guard exclusions.

The worker MUST publish raw compiler return, config, substituted fixture identity, parent timestamps and argv/tool identity before interpreting diagnostics. Raw streams MUST be regular, bounded and hash-verified. Positive success requires code0 and empty diagnostics/output. A negative requires code1 or2, exactly its frozen fixture-relative line and diagnostic code, no unrelated error/warning/output, and positive reap. No suppressed errors, golden updates or missing-module passes are allowed. Diagnostic column is captured, not invented as a frozen expectation. Unexpected resolution/syntax/tool/config failures are fixture/binding defects; other type contradictions remain declaration-contradiction review, not automatically product bugs.

TYPE-PUBLIC-FIVE MUST return UNRUN_PUBLIC_EXPORT_GAP without a compiler request for this exact b8 plan. Its five real source programs remain reserved. A future accepted root export requires a separately sealed plan/candidate authority and review; this worker MUST NOT modify root exports or infer public import admission from an internal entry. TYPE never counts as YQ semantic success.

## LOADED Contract
Ten exact slots comprise two pristine positive loads and eight mutant/witness invocations, with three transformations and four witnesses per two profiles. Each positive invokes frozen UTF-22--whole once. Each mutant invokes its declared frozen witness once; its prerequisite is the already captured, core-authenticated pristine witness from that environment's preceding149, not an extra baseline invocation or old candidate receipt.

Core materialization MUST freshly copy the complete pristine870/control tree, then physically move the installed profile outside workspace before loading. Workers MUST compare complete returned maps and actual entry identities to the sealed pristine/postimage map. Core MUST enroll exact variant edits under purpose-specific RootGO; ordinary pristine guards MUST reject those postimages. Multiple edits use successive pre/post hashes, including the pending-shadow intermediate image. No base/source/package mutation, alternate edit, private DI, cap lowering or source fallback is permitted.

Core capture MUST actually import via its authenticated loader and invoke the unchanged fixture context. It MUST record canonical root/entry, every resolution/parent/hash, factory and supported command binding, invocation and durable raw completion. Each control root is a unique module-cache identity; candidate dependencies MUST stay inside its exact file map or the separately admitted candidate builtin list. Harness bindings are separately core-admitted. Unloaded/hash-denied/crashed/timed-out controls MUST NOT receive kill credit.

Baseline primitive facts MUST match frozen status, bytes/documents and diagnostic before a kill is considered. Baseline projection MUST be BOUND_PROJECTION_ONLY, not INCOMPLETE/FAIL. Retained-view kill is a normal captured status or exact output change; quoted-DEL kill is a normal status change; pending-shadow kill is a normal status or ALIAS_CURRENT_NODE diagnostic change. These are the exact bounded plan predicates, not generic failures or full-record acceptance. The stable legacy DOUBLE slot actually uses single-quoted UTF-02; SINGLE uses double-quoted UTF-03. Only descriptive labels are corrected.

## State Machine, Failures and Resources
Workers MUST follow setup, admission, operation, capture, cleanup, complete. Core notes provide repeated operation subevents and parent clock facts. Worker bodies MUST NOT spawn, import product, own timers, reset deadlines or retry. One outer plus one nested compiler is maximum per owner; coordinator/supervisor bring the process maximum to four. Cleanup/reap remains inside540000/540000/480000 TYPE caps and ten90000 LOADED caps, global24165000ms and exact336 slots. These are caps, not duration estimates.

Core raw combined compiler cap is8MiB; fixture cap2MiB; JSON publication16MiB; IPC262144bytes; per-job metadata32MiB; global disk24GiB. No silent truncation or hard RSS guarantee is made. Large full maps MUST remain data projections rather than being copied into IPC notes. Materialization roots are retained for cumulative core guards.

Ordinary mismatches return sticky FAIL only after positive integrity and known reap. Unknown/failed reap, authorization, loader, map or provenance failures MUST throw unsafe and stop admission. A matching expected compiler rejection is internal classification inside a zero-exit worker, not a waiver for actual worker/parent nonzero, signal, timeout or overflow. Core alone issues final job receipts and observes actual process exit/reap. Worker-return PASS is conditional role proof until that happens.

## Validation Matrix
`DEFERRED-CONTROLS.json` freezes future checks before validation. Preparation MAY check static syntax, import graph, literal transformations, fixture/input hashes and finite matrix algebra only. It MUST NOT import authored modules or execute workers, predicates, loader controls, compiler, build or product. Static evidence MUST distinguish checks from still-UNRUN dynamic controls. Independent reviewer and root composition remain required.

## Open Integration Requirements
Core must implement RESULT-SCHEMA projections, supply authenticated preceding149 baseline capture facts, register generated scratch entries and guard complete tool/declaration resolution. Root must seal every executable/data projection and grant a new GO separately. This component does not implement build or core supervision and does not declare the compound recipe complete. TOCTOU between separate checks and arbitrary host mutation are not eliminated by these guards.

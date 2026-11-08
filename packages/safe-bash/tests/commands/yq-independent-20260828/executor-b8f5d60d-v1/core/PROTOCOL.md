# B8 Successor Executor Specification

Status: Accepted interface; concrete implementation statically sealed, no dynamic conformance claim

Implemented Through: Not applicable

Purpose: Define the sealed worker ABI, observable one-clock supervision and strict candidate admission for the root-authorized finite successor cohort.

## Normative Language
The words MUST, MUST NOT and MAY identify mandatory behavior and explicit options.

## Problem Statement
The core MUST coordinate exactly336 outer slots under24165000ms, without retry/reset. It MUST NOT import or execute candidate code during this preparation. The boundary includes trusted harness, explicitly copied tools, authenticated candidate and unique evidence. Host JavaScript is not an OS sandbox.

## Goals and Non-Goals

The implementation MUST provide concrete, observable, bounded execution machinery and preserve the exact frozen proof-role inventory. It MUST NOT add product semantics, private hooks, public exports, new policy cases or an execution authorization. Dynamic conformance, candidate acceptance and general host sandboxing are not preparation claims.

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

## Test and Validation Matrix
Static preparation checks MUST inspect syntax, source/diff hashes, finite algebra and exact frozen projections without executing workers, loader, predicates, compiler or product. A different reviewer later needs controls for nonzero-after-PASS, safe failure continuation, before-assert capture, mutation/added-entry/mode STOP, timeout/reap gating, receipt corruption, phase overflow, tool ownership, loader path denial and actual loaded mutants. These dynamic obligations remain UNRUN until separately authorized. Conformance is not established by this interface seal.

## Concrete Implementation and Version Binding

The executable bodies now reside in this core directory. Their complete source seal is `SOURCE-SEAL.json`; its expected raw hash and exact Git commit MUST come independently from the root handoff. No dynamic conformance is claimed. `INTERFACE-ADAPTER.json` defines the explicit compatible refinement of the early interface at `9d582d791336fd66d865f6592b830c39a359d344`. The independently authored TYPE/LOADED component is exactly `c0353685540288d504b93f206735fe4c448268ef`, final seal `f5eb6e660f627c6cf1d029682b06f0f9b836b4bc98ccd5bc85c3ec68b811a0e2`. Its old files MUST NOT be edited by the core.

The build dispatcher now names `core/build-stage.mjs`, rather than the early placeholder under workers. The peer supplied no build worker. No evolving foreign `build/` directory is read, imported or admitted. The core build body performs one independently scoped compiler invocation, preserves raw output membership, validates source-map origin, relocates only `sources[0]`, compares all compiled bytes, retains full baseline README/package metadata and independently serializes the declared USTAR/gzip package. It MUST NOT copy author compiled output as independent compiler proof. The author artifact remains `AUTHOR_ARTIFACT_BINDING_ONLY` until that future operation actually succeeds.

The core launch command is `node core/cli.mjs --root-go ABSOLUTE_JSON --root-go-sha256 HEX --recipe ABSOLUTE_JSON --recipe-sha256 HEX --evidence ABSOLUTE_NEW_DIRECTORY`, using the independently authenticated copied Node executable with no Node preload flags or ambient NODE_PATH/NODE_OPTIONS. Root MUST authenticate the trusted bootstrap body before launch; a JavaScript program cannot authenticate already executed hostile bootstrap code. Own builtin-only bootstrap imports do not imply candidate admission. Missing, malformed or false RootGO MUST deny without a child, candidate import or evidence write.

`compose.mjs` exports `composeRecipe(options)`. It performs no candidate import or child admission and requires exact expected core/worker seal hashes. Its output recipe MUST be outside both active code trees, avoiding self-referential manifests. The recipe binds all members, including self-seal bytes through external hashes. Root supplies a fresh exact tool map, source/package artifact descriptors, review references, run ID and matching unique evidence destination. Reusing an already created destination is refused. `ROOT-GO-TEMPLATE.json` is deliberately DENY and MUST NOT be treated as an authorization. `copy-tools.mjs` is a separately gated data-only preparation helper, not another execution allowance or GO; admitted tool copies are fixed inputs before the actual cohort clock starts. No tool copies were produced in this preparation.

## Environment and Proof Matrix

There are exactly two command profiles: A is the independently source-built compiled full tree, invoked through the direct factory; B is the full 870-file package physically installed/materialized and then renamed to a different path before direct-factory invocation. Installed-unmoved is only an admission/movement origin, not a third semantic cohort. The historical word original does not name the new A profile.

Each profile has all 149 frozen jobs covering the same 132 IDs. The 194-ID ledger and eight overlapping overlays remain unchanged. Roles remain 111 command semantic, 34 admission/error, 23 source static, 11 lifecycle, four package/infrastructure, five type and six negative-control records. The historical 94 complete-eligible/17 partial distinction is not a pass count. Eighty records and 135 missing bindings remain UNRUN obligations, never automatic product bugs. Types, source/data, admission, moved and control receipts MUST NOT increase a semantic pass rate or be summed across environments into unique-ID coverage.

Six direct compiler fixtures run separately in A and B. The five conditional public fixtures remain UNRUN_PUBLIC_EXPORT_GAP for this candidate, not fake missing-module negatives. Twelve direct fixture calls plus one build and five reserved public calls give eighteen maximum compiler descendants. There are ten loaded slots: two positives and eight mutant/witness invocations. The existing same-environment earlier149 pristine witness MUST be authenticated before variant materialization; it is not rerun. Hash refusal, generic rejection, missing actual modified-file load or timeout MUST NOT receive killed-mutant credit.

F01 is unchanged for every original runtime job. The exact four loaded-control witnesses additionally permit the unchanged historical primitive assertion body, with their exact frozen job hashes. The original full F01 obligations file MUST be written first. In particular UTF-22's natural-language obligation remains INCOMPLETE in its runtime/record receipt; matching retained-view bytes alone MUST NOT green that record. A LOADED-only result MAY describe the predeclared primitive projection as BOUND_PROJECTION_ONLY while carrying fullRecordStatus INCOMPLETE and the original obligations path. This is not a new expected value, golden rewrite, policy case, extra command or assertion waiver for the original record.

The source-audit worker authenticates the selected source and emits the 23 designated records/four repair qualifications. Missing source arguments remain UNRUN. WRK06 C+1 rejection is not at-C success; WRK07's author fixed-scalar/noopWork proof is not full public budget proof; WRK17's internal small encoder limit is a proof control, not a public cap. Masked or unreachable at-C obligations still need exact gate arguments, without lower caps or injected private state.

## Bounded Resources and Timing

The absolute phase ceilings in milliseconds are 120000, 300000, 180000, 570000, 300000, 6705000, 13410000, 1560000, 900000 and 120000. Their sum is 24165000 (6h42m45s), over exactly 336 outer slots. Cleanup is inside these ceilings. The original supervisor origin is the first authentication reservation; first-phase bookkeeping MUST NOT turn it into a later full-budget reset. Later phase-start and first-slot reservations use one timestamp. The core MUST refuse insufficient remaining slots as UNRUN and MUST NOT retry or resume them.

The parent records reservation/preflight, worker startup, admission, candidate import start/end, actual command/owned compiler work, capture, cooperative cleanup and final process close/reap. The sealed peer's operation request is a note until loader admission completes; its capture acknowledgement is not a second phase or clock. Type batch operation includes fixture generation, while actual compiler process spawn/close has separate parent facts. Node/TypeScript startup is not claimed to be isolated compiler CPU time. Old setup-versus-semantics elapsed time was not isolated and supplies no performance root-cause proof.

`CAPTURE-AND-TOPOLOGY.json` is the exact resource ledger. Peak authorized processes are supervisor + coordinator + one outer + one tool = four; workers never spawn. Each process stream is spooled to a unique binary file, with 16MiB combined worker streams or 8MiB combined compiler streams. Per-job combined raw/metadata reservations are 32MiB, including a 4MiB parent-event reservation. IPC messages are at most 262144 bytes, with 2048 messages/outer; phase logs have at most 4096 events. The fixed storage reservation is 23.25GiB within the 24GiB logical-byte cap. This is not an OS disk quota, physical-allocation proof, hard RSS bound or arbitrary-host preemption guarantee.

The inherited fixture capture limit is 2MiB, while the candidate's fixed combined output maximum is 16MiB and its stdout allowance is 16773120 bytes. The largest frozen input is 400007 bytes and largest fixture file is six bytes. This projection limit MUST NOT be promoted into public output-quota or at-C proof. Overflow preserves bounded raw bytes/explicit failure, stops unsafe admission and is classified as harness limitation, not a false candidate bug. No silent truncation is a successful capture.

## Authority Closure and Guard Placement

The source policy is exact baseline5137 + accepted-length7436 + seven selected b8 source paths. The source archive retains 273 files; the consumer projection has 271; full package has 870 and the complete baseline README. Whole candidate Git301 and mutable HEAD are not source authorities. Every active executable/data projection has fresh path/kind/mode/size/hash provenance. The legacy v1 FINAL-SEAL is content-only ORIGINAL_MODE_UNATTESTED, never an executable/admission-mode authority; original90a633 and e729 failure history is preserved.

Git authenticates the explicit selected immutable origin tuples once in AUTH, using registered fixed argv and copied regular Git. Subsequent jobs depend only on the newly admitted source/package closure, never cached mutable file trust. Before/after every outer job, all active recipe/tools/source/package roots and all retained moved/materialized roots and closed evidence prefixes are checked for exact membership, added entries, bytes, modes and root identity. Each invoked tool body is checked before/after; each compiler additionally checks the complete copied tool tree. Repeating the full tools/tree sweep for every tiny Git metadata call is not required: its enclosing AUTH job retains the full before/after closure and each Git executable/object result is freshly checked. This is an explicit placement rule, not skipped source provenance or a lease against change-and-restore races.

Compiler fixtures use exactly the enrolled two-file scratch folders and explicit copied type roots. Ambient ancestor node_modules and source/workspace fallback are refused. Candidate resolution permits only the selected regular compiled tree and declared builtins, with actual parent/path/hash load evidence; no private hooks, DI, public YqLimits or implicit network are introduced. Tool bootstrap, root receipts, current source, package and all code remain strict even though historical data-only mode uncertainty is no longer an execution blocker.

## Remaining Conformance Evidence

Source bytes, static syntax, input hashes, finite algebra and peer ABI matching can be checked now. Actual supervisor/process-group termination, nonzero and timeout continuation gates, capture preservation, mutation/mode/addition STOP, malformed receipt refusal, type compiler diagnostics, moved loading, actual mutant kills, independent build and candidate semantic observations remain UNRUN. Root MUST route a different bounded reviewer and supply complete independent expected seals before issuing fresh execution GO. Static author preparation MUST NOT be described as runtime acceptance or a product pass score.

## Conformance Criteria

A later conformance claim requires a different review of the exact sealed implementation and positive evidence for each applicable mandatory rule in the validation matrix. Missing proof or a source/type/package role receipt MUST NOT be represented as semantic acceptance. This static author seal alone does not satisfy dynamic conformance.

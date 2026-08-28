# Final Concrete Composition: Independent Static Review

Status: CHANGES_REQUIRED

Inspected revision: `b1b8566686769e5e53433048f2058ab09d8c00c3`.

Purpose: Report concrete source contradictions and verified static bindings;
this is an audit, not a new product specification or execution authorization.

## Verdict

**CHANGES_REQUIRED: three CODE findings, no identified SOURCE-INTEGRITY mismatch.**
The actual composition, raw archives and copied-tool data authenticate. The
following three enforcement defects prevent a STATIC READY verdict. None is a
claim about actual Yq behavior, measured overflow or observed timeout. Missing
future build/type/move/mutant observations are UNRUN, not additional preparation
defects. The root must route owner corrections and a newly sealed composition;
this reviewer changes no executor source and grants no GO.

Criteria were sealed in33ce3f58 before composition-body inspection. Live AGENTS
was read first, including the current cross-realm own-data/identity rule. All
source inspection is post-candidate and preexecution. Prior74fc/CW-F01/CW-F02 and
all older reviews/failures remain unrescored.

## Actionable Findings

Paths below are relative to
`tests/commands/yq-independent-20260828/executor-b8f5d60d-v1/composition-v2/`.
Every witness contains the exact source revision, whole-file hashes and raw
line excerpts, and was committed before its finding was reported.

| ID | Code location | Contradiction and minimum correction |
| --- | --- | --- |
| FC-F01 | `assembly/core/worker-api.mjs:179`, `assembly/core/worker-host.mjs:28`, `assembly/core/tool-bridge.mjs:19` | Tool-call serialization precedes exact own-data validation. JSON serialization can invoke an accessor or erase an extra undefined-valued key before parent `keys` sees it. Validate finite own-data descriptors/keys/types/values at the real pre-serialization boundary, without prototype identity or coercion; retain parent route/config checks. |
| FC-F02 | `assembly/core/supervisor.mjs:102`, `assembly/core/owned-process.mjs:77`, `assembly/core/supervisor.mjs:161`, `assembly/core/supervisor.mjs:205` | The declared32MiB raw+metadata job balance accounts for request/phase/raw/worker artifacts, but not process receipts and several parent publications. Final job inspection permits256MiB, not32MiB. Reserve/charge all parent/tool terminal and failure metadata and enforce the total without raising the cap or discarding required evidence. |
| FC-F03 | `assembly/core/phase-capture.mjs:16`, `assembly/core/phase-capture.mjs:20`, `assembly/core/phase-capture.mjs:41`, `assembly/core/owned-process.mjs:84` | A late capture transition checks only jobNs, then changes the current deadline from the expired semantic deadline to workNs. If it precedes the next10ms monitor tick, lateness can escape timedOut. The analogous setup transition has the same gap. Preserve transition evidence and validate the outgoing deadline before removing it; polling precision is not the fix. |

Frozen witnesses: FC-F01 commit`2df1dab1`; FC-F02 commit`cbf906a3`; FC-F03
commit`a3c3e658`. These are independent source traces/static arithmetic, not new
executed synthetic cases. The budget finding is an unclosed upper bound, not a
claim that this candidate necessarily saturates it. The deadline finding does
not demand impossible hard preemption; late completion must still be classified.
No additional product-policy decision is needed to address these invariants.

## Exact Authentication

| Artifact | Raw SHA256 |
| --- | --- |
| FINAL-SEAL | `e2d4dd59a490d71f498e7ca5a26eb37a17325500c6e7b535f78e82373cf88ebd` |
| ASSEMBLY-SEAL | `de9b45808d9ebb23dd74c950637d9643c9125107c487b3625773f1280d5d8d5e` |
| RECIPE | `40c9e4c0a407fd1ebebbb17a421a52d2949c3ef6316b4a46499504127b64174d` |
| TOOL-DATA-COPY | `0d0793d63f31b1d1f5cc91d2d77fe5b14c854c0c3980dd2d25e90c06a424e5b8` |
| LOAD-AND-TOOL-SEAL | `edfd944ea63674c3123ebb3036f1f43daf94bb938bd7660dccf611582b451e8a` |

COMPOSITION-AUTHENTICATION binds89 committed files,70 active files and31 modules,
their raw hashes/sizes, regular Git classes and observed current0644 modes.
All67 declared origin/postimage pairs match. Exactly six core modules plus
TOOL-SOURCES data change; new paths are build-adapter, physicalBindings and the
fresh worker INPUT-PRESEAL. Parent build-stage, compose, copy-tools and primitive
fallback module are excluded. Dispatch has one BUILD target, the exact937c
build-worker, and no second compiler/fallback. The exact89bc type and9fe loaded
postimages remain intact. Original parents are83eed587/c035 and BUILD937c1f6a.

The physical root `/private/tmp/yq-b8-composition-v2-bMqyvD` contains only tools
and inputs, no execution directory. Independent complete before/after data
snapshots match249 regular tool files/146740654 bytes:248 compiler-tree files
plus sibling Git. Hash, size, full mode, canonical path, nlink1 and identity were
checked; tool-profile digests are independently reconstructed from manifest
data. Both raw archives match their committed origins and routed hashes:
source`fe76de08017859b066ecb8830846e109cdab6fa3953b0317e5fc6f27777fd878`,
package`1d06350cdef1a5f6c7d70c7d55a19b63537037bd97b2de5a5d8b8f722229ca`.
No copied executable was invoked. These observations do not prove absence of
intervening change-and-restore or any tool behavior.

Selected271/archive273/full870 remain distinct, including exact README and
package.json. Archive-only package-lock.json and scripts/typecheck.mjs remain
authenticated data, not silently dropped. Origins are265 baseline5137 entries,
one7436 interpreter and seven b8 Yq/query-core entries, never wholeGit301 or
author tests/protocol. Source-map9b0e0d62… and package-mapaef2daac… match accepted
dffc/e729 DATA. No archive extraction audit or author compile was repeated.

## Admission, Mode and Ownership

`admission.mjs:65` requires separately supplied root/recipe hashes, fresh0600
receipt and0644 recipe, RootGO true and a nonexistent exact evidence destination.
Its envelope binds fixed physical archives/tools, one exact active union and
fresh0644 independent-composition-review references. Default CLI is DENY; no
receipt/token/runId was created here. Root's review-reference choice remains an
explicit trusted-root decision, not self-authorization by the recipe.

Historical90a selfseal appears only as content identity/role data in fresh
physicalBindings and root equality/classification checks (`admission.mjs:21,27`).
It is not read, executed or admitted by an original-mode predicate, and is absent
from active tool/source/package origin maps. ORIGINAL_MODE_UNATTESTED is honest;
original DENY is preserved. This is not a blanket old-mode exemption: the fresh
active projection, sources, package, tools and review references remain guarded.

Supervisor owns the coordinator, one outer and one nested tool (peak4 including
itself). Raw process files precede classification; outer and parent nonzero,
signal, timeout and overflow remain sticky aggregate failure. Missing/duplicate/
malformed results cannot green. Ordinary assertion/incomplete continuation is
gated by integrity AND known reap; unsafe admission, provenance, loader/integrity
or unknown reap stops admission. Group ownership is explicitly tracked, not an
escaped-descendant/host-JS sandbox guarantee. The shared rejection encoder uses
reference tokens for objects/symbols and distinct primitive descriptions across
command and cleanup; stringified error text is not its identity authority.

## Build, Types and Loaded Controls

The build adapter derives exact generated config bytes, admits them before the
one compiler, and retains baseline config/source/tool guards. ToolBridge derives
literal argv/cwd/environment from admitted paths and actual process metadata.
Large artifacts are local bounded publications, not full maps/tar over IPC.
After outer zero exit and known tool/outer reap, `build-adapter.mjs:59` rereads
artifact identities, raw compiler receipt, complete870 tree/README,868 comparison
rows, entry/declarations, archive/tar, proof and final integrity before adopting
A. The pending output note grants no import. These are concrete source checks,
not an independently observed build or byte-exact packing success.

TYPE follows six fixtures per source-built/moved profile. All raw compiler
output is captured before corrected matching; unknown output/module/declaration
binding failures cannot become expected negatives. The parent stops on declared
fixture/tool/binding defects. Copied Node/types and transitive declaration roots
are isolated and fully guarded; raw declaration identity does not replace the
future compiler calls. Public5 remains explicit UNRUN, not missing-module PASS.
Only verified expected compiler negatives may coexist with zero worker exit;
no actual worker nonzero is waived.

Core preserves CW-F02: both UTF22 positive roles remain INCOMPLETE only when
primitives match; contradiction remains FAIL. Both retained-view slots are gated
before outer spawn/materialization/import (`supervisor.mjs:77`); no primitive
promotion or authorized observation adapter exists. Six other mutant slots need
genuine same-environment earlier149 pristine evidence before copying/loading.
Loader hashes actual entry/dependencies; leaf requires the changed dependency's
actual load and normal invoked witness with declared behavior change. Crash,
rejection or hash denial is not a kill. No dynamic mutant credit is awarded.

## Matrix and Ceilings

| Phase | Outer reservations | Ceiling seconds |
| --- | ---: | ---: |
| Authentication | 1 | 120 |
| Build | 1 | 300 |
| Setup | 2 | 180 |
| Controls, including one31-definition CMD22 worker | 19 | 570 |
| Source audit | 1 | 300 |
| Source-built direct | 149 | 6705 |
| Installed then physically moved direct | 149 | 13410 |
| Types | 3 | 1560 |
| Loaded controls | 10 | 900 |
| Finalization | 1 | 120 |
| Total | 336 | 24165 |

This is6h42m45s, not a forecast. Slots are45s source/90s moved or loaded; the
source/moved setup caps are5s/40s and semantic operation30s. Cleanup is reserved
inside caps; FC-F03 identifies the transition-enforcement defect, not a changed
schedule. Two retained-view slots are known pre-outer denials, so at most334
outers could start absent other refusals;336 reservations remain unchanged.
Public-gap reporting still has one outer slot. Compiler slots are12 direct+1
build currently planned, plus5 conditional public=18 reserved maximum.

Worker streams16MiB combined, compiler8MiB, job raw+metadata32MiB, IPC262144
bytes/2048 messages, phase4096 events/4MiB and180 copies are the coded limits;
FC-F02 identifies the aggregate accounting defect. The reservation arithmetic
is24964497408 bytes=23.25GiB within24GiB, not an OS quota. Frozen command2MiB/
20000-event capture is distinct from public16MiB. HOST_CAPTURE_MASKED, at-C
source arguments and23 source/four repair roles are not public runtime, memory
or progress proof. No caps are lowered and no state injection is introduced.

149 jobs per profile project the same132 IDs; each profile has128 semantic-role
jobs and21 admission-role jobs, not149 unique semantic passes. Original194 roles
remain111/34/23/11/4/5/6 with eight overlapping overlays,94 eligible complete/17
partial semantic IDs and80 records/135 missing bindings. Source-only, type,
package, admission, infrastructure and control roles do not enlarge a semantic
denominator. Old4b219 FAIL, CMD22/31 unfulfilled/deadline UNRUN and prior author
receipts remain history. Full-record acceptance and semantic pass rate are not
claimed; all current candidate/control/runtime executions and passes are0.

## Validation and Next Boundary

All31 exact module bodies parsed with existing trusted host Node in syntax-only
mode; raw exits/streams/PIDs are retained in SYNTAX-CHECKS. No authored module or
copied tool ran. DATA-AND-SCHEDULE-AUDIT records the actual arithmetic/bindings;
PHYSICAL-DATA-AUTHENTICATION records the copied-data observations. Three reviewer
preparation failures remain separately recorded, not recast as author defects.

Minimum next work is owner-only correction/sealing of FC-F01–03 and independent
inspection of the resulting exact source/recipe/closure. Future independent
build/type/runtime/move/control observations remain UNRUN, and known binding
gaps remain substantive gaps. Do not request or grant fresh GO from this verdict.
The user's full YAML/shell objectives are not complete.

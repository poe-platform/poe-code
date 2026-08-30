# Independent Build Worker Specification

Status: Proposed

Implemented Through: Not applicable

Purpose: Specify the concrete, source-sealed future b8 build worker and its mandatory core integration without claiming compilation or granting execution.

## Normative Language

MUST, MUST NOT, REQUIRED and MAY express this component contract. Implementation-
defined parent behavior MUST be fixed in a fresh compound seal before RootGO.

## Problem Statement

Profile A needs newly compiled selected b8 source. A byte-bound author package or
old35da independent build cannot supply that proof. The build worker body must be
sealed before future execution, while existing TYPE/LOADED workers and core remain
separately owned. This preparation performs no compilation, worker invocation,
candidate import, serialization, loader run or proposed harness cohort.

## Goals and Non-Goals

The future worker MUST reproduce all 868 outputs, construct a fresh 870-file tree
and serialize the exact complete package from those new compiler outputs. It MUST
retain raw maps and distinguish the sole declared map-source relocation from raw
byte equality. It MUST NOT copy author JS/declarations as source-built output.

The worker MUST NOT implement semantics, TYPE/LOADED cohorts, public integration,
source repair, root supervision or a new ABI. Product P1 caps, at-C obligations,
CARRY and internal-proof/public-proof distinctions remain unchanged. This static
component is not an independent build result and does not inherit old passes.

## Authority and Active Closure

The core ABI is `yq-b8-core-worker-v1` at
`9d582d791336fd66d865f6592b830c39a359d344`, raw SHA-256
`c5e36798741667981f21f002755be3f420fbd6103b8a4b3f8783531a9f6fc412`.
The worker MUST export `async runWorker(api)` and have no top-level effects,
spawns, Git, timers, candidate imports or `process.exit()`.

`ASSEMBLY-MAP.json` defines the six source-to-target projections in a fresh
assembly. Core MUST authenticate original component membership before assembly,
then seal the complete new union. It MUST NOT edit or reuse the old workers global
membership seal as if the enlarged assembly had unchanged membership. All active
code/data MUST receive fresh exact kind, path, mode, size, hash and parent guards.

Purely historical legacy v1 final-seal content MAY be labeled
`ORIGINAL_MODE_UNATTESTED` under the root's sealed decision. It MUST stay outside
active execution/admission mode authority. The old v1/v2 DENY/failure records remain
unchanged. No historical full mode is inferred or repaired by chmod.

## Exact Inputs and Compiler Projection

The candidate is `b8f5d60d75452e1dd181167fb87abd995221f6e3`, evidence
`644460b932feb6fa87222b7042d705da1219cf0c`, handoff
`065f824d06e36de3fafaee1b7a5baa278f40407c`. Source MUST be the exact 271-file
baseline5137 plus accepted7436 interpreter plus seven YQ/query-adapter paths,
not the whole candidate Git tree. The 273-file archive and eight excluded author
test-data entries MUST NOT enlarge compiler inputs. All 217 selected TypeScript
inputs MUST correspond bijectively to 868 expected emitted paths.

`readBoundJson` MUST supply the sealed build plan and exact source/package maps.
The worker independently hashes their complete contents and checks fresh regular
source/tool trees, modes, membership and aliases before requesting a compiler.
The Node binary and TS5.9.3/@types-node/undici files MUST match all pinned identities.
The explicit copied tool layout is `node`, `typescript`, `node_modules/@types/node`
and `node_modules/undici-types` below the admitted tool root. These are existing
copied tool files, not installation or ambient dependency resolution.

The fresh scratch config MUST extend the unchanged selected `tsconfig.build.json`.
Its only compiler-option changes are absolute `outDir` and explicit `typeRoots`.
Source `tsconfig.json` and `tsconfig.build.json` MUST remain byte-identical. Strict
NodeNext/ES2023, declarations/maps, source-only inclusion and existing skipLibCheck
remain unchanged. No global typecheck, foreign `.mts`, npm script, lifecycle hook,
compiler wrapper or version probe is authorized by this worker.

## One Clock and Tool Ownership

BUILD-SUCCESSOR has one 300000ms outer phase/slot and one compiler descendant capped
at 120000ms. Setup, admission, compiler execution, comparisons, serialization,
materialization, capture and cleanup MUST remain inside that same parent budget.
`phase` and `note` MUST NOT reset any deadline. The worker MUST request the compiler
only through `api.runTool({kind:'compiler',configPath,timeoutMs:120000})`.

The supervisor MUST own all children, raw spooling, termination and known reap.
Fixed argv is `[typescriptRoot+'/lib/tsc.js','--project',configPath,'--pretty','false']`;
cwd is request scratch; environment is exactly LANG=C and LC_ALL=C. The parent MUST
guard the generated config and tool paths immediately before admission and record
actual argv/cwd/identities/times, not echo the worker's expectation as observation.

Detailed `result.provenance` is REQUIRED as defined in BUILD-RESULT-SCHEMA. The
committed ABI lists the base return fields but does not itself establish that
additional envelope. Missing provenance MUST fail unsafe, not supply fabricated
parent timestamps or a PASS. This is an explicit integration dependency.

## Capture, Output Comparison and Packing

The raw compiler return and parent stream artifacts MUST be durable before compiler
assertions. Nonzero, signal, timeout or overflow MUST fail; unknown reap or integrity
MUST stop admission. The worker MUST retain raw partial output and failure metadata,
never retry, repair source, normalize a genuine mismatch or infer a source bug.

All 434 JS/declaration files MUST match their expected raw identities without edits.
Each of 434 maps MUST have the exact presealed metadata shape, compact serialization,
empty sourceRoot and one canonical selected-source target. Only `sources[0]` MAY
change to the logical package-relative source path. Raw and relocated hashes and
actual changed-field facts MUST be recorded; every final map must match expected
bytes. Unexpected files, directory modes, source targets or metadata MUST fail.

Only after all 868 comparisons pass MAY the worker create the package tree from
new emitted bytes and declared map relocation, adding only unchanged source
README.md and package.json. The full 846 baseline plus 24 additions MUST match.
Exactly one in-process USTAR/gzip serialization MAY occur, using the presealed
870-entry order, regular0644, omitted owner/group, epoch499162500, npm octal fields,
two zero blocks and gzip9/default-strategy/memLevel8/windowBits15/OS255. No native
tar/gzip/Python child is allowed. Raw tar/package bytes MUST be captured before
asserting their expected hashes, including full package
`1d06350cdef1a5f6c7d70c7d55a19b63537037bd97b2de5a5d8b8b8f722229ca`.

## Result and Core Revalidation

Only successful future completion of compilation, capture, every output comparison,
packing and final input/output guards permits `INDEPENDENT_BUILD_REPRODUCTION`.
Returned manifests MUST be compact artifact references, not large inline IPC maps.
Core MUST reauthenticate each referenced object and fresh tree, require the outer
process's zero exit and known reap, and then bind `sourceBuiltRoot` for A and the
full package origin for B. It MUST NOT adopt a partial/failed build's stage output.

The matrix remains two profiles of149, A source-built direct and B full-package
installed then physically moved direct. Installed-unmoved is admission only.
Build1 + direct types12 + conditional public5 =18 maximum compiler descendants;
current public5 stay UNRUN. This component adds no slots to336 or time to24165000ms.

## Test and Validation Matrix

| Requirement | Current preparation | Deferred proof |
| --- | --- | --- |
| Body syntax and closure | Node syntax checks; literal imports and assembly map | Authenticated worker host loading |
| Full data inputs | Immutable Git/raw hashes and complete map arithmetic | Fresh source/tool tree guards |
| Compiler ownership | One literal IPC call; no spawn/timers/Git | Supervisor descendant/reap/overflow controls |
| Exact outputs | Concrete comparison/relocation implementation | All868 future comparisons |
| Exact full package | Concrete builtin USTAR/gzip implementation | Fresh870 hash equality |
| Failure preservation | Concrete durable-before-assert and failure paths | Nonzero/mode/addition/malformed-map controls |
| A/B provenance | Precise stage-output schema and integration requirements | Core promotion, A semantics and moved B |

## Conformance Criteria

Current conformance is limited to source/data/syntax preparation. Dynamic build and
core compatibility MUST remain UNRUN until separately authorized and observed.
Bounds are retained-byte/process contracts, not RSS forecasts, sandbox guarantees,
transactionality or detection of change-and-restore between observations.

## Open Questions

Core must bind the required provenance refinement, generated-input enrollment,
local large-artifact publication and stage-result revalidation in its future
compound seal. No API method addition is requested. No product policy question is
reopened; no current execution GO exists.

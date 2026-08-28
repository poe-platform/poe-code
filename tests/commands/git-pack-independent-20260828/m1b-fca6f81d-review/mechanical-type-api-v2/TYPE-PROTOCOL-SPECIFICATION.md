# M1B Compiler-API Type Protocol Specification

Status: Additive prelaunch proposal; source authored, compiler execution UNRUN

Implemented Through: Not applicable

Purpose: Check the original five strict type fixtures without confusing normal compiler diagnostics with an owned CLI process failure.

## Normative Language

MUST and MUST NOT define this additive harness protocol. They do not extend the
product API or authorize execution. The old mechanical component remains immutable.

## Problem Statement

The earlier `de95161c` ABI and mechanical `2add02bd` component require expected
negative tsc CLI exit2 to remain aggregate FAIL. ROOT now requests a compiler-API
validation process, not a nonzero-process waiver. This protocol supersedes only
the five TYPE cases' compiler transport/materialization/response interpretation.

## Goals and Non-Goals

The original T01–T05 fixture template bytes and primary diagnostic expectations
MUST remain exact. The original22 ownership/checkpoint/counter cases MUST forward
unchanged to their old sealed modules. Build's separate normal tsc CLI is unchanged.

This packet MUST NOT execute TypeScript, candidate code, helper controls or mutant
witnesses during preparation. It MUST NOT change product source, type declarations,
compiler source, fixed caps or public exports. PUBLIC_EXPORT_GAP remains explicit.
M1B native resource qualification, S02 and three semantic-mutant witnesses remain
outside this correction and unresolved as recorded previously.

## Compiler and Input Authority

TOOLS binds the existing unmodified Node22.22.2, TypeScript5.9.3,
@types/node22.20.1 and undici-types6.21.0. SUBJECT binds the full910 package and
the227 declarations plus package.json visible to the compiler. No candidate JS
is imported or evaluated by the type worker. S's subject MUST come from the
independent build; copying author output cannot establish S.

The runner MUST provide physical, disjoint case/subject/tools roots with exact
regular-file inventories and measured or freshly declared modes. Symlinks,
unexpected entries, AGENTS files, wrong modes/hashes or missing entries MUST fail.
The type tool layout is bin/node and node_modules/{typescript,@types/node,
undici-types}; no npm or unrelated package is admitted. Reuse is permitted only
for an already identical admitted layout. A new restricted regular-file copy,
if needed, MUST be budgeted and sealed by the runner before launch.

The case root MUST be0700 and contain only the0600 request and the0600 projected
fixture before execution. Request fields and order are fixed in INTERFACE-PROPOSAL.
The runner authenticates the request hash before spawning; the worker repeats it.
The request MUST NOT supply compiler flags, arbitrary roots, fixture text or
expected diagnostics. The worker derives those from its sealed data.

## Fixture Materialization

The runner MUST retain all five template byte identities in FIXTURES. It replaces
only complete quoted `__GIT_ENTRY__` and `__CONTRACTS_ENTRY__` tokens with
JSON-quoted absolute POSIX filesystem specifiers ending `.js`. All other bytes
remain unchanged. The worker independently reconstructs and checks the result.

This is an explicit prelaunch correction to the old file-URL recipe, not a
post-run normalization. The pinned compiler's isExternalModuleNameRelative uses
relative/rooted disk paths; its URL roots are classified separately. The new
protocol does not install a custom module-name alias or fabricate a resolution.
Normal NodeNext resolution finds adjacent admitted `.d.ts` declarations. No
unresolved import may be discarded or accepted as the intended negative result.

## Unmodified Compiler and Guarded Host

The worker evaluates the exact authenticated typescript.js bytes inside a normal
CommonJS-shaped wrapper in a separate VM context. The wrapper is harness code;
it does not patch compiler bytes or public compiler functions. VM isolation is
not a hostile-JavaScript sandbox or hard resource guarantee.

The finite require table admits fs/path/os/crypto/perf_hooks only. The fs binding
is an explicitly read-only admitted-snapshot host, not unrestricted host fs.
Normal custom CompilerHost source reads, existence checks and module resolution
operate on the same finite file map. Missing paths are absent in this declared
namespace; they MUST NOT fall back to the workspace, HOME, parent node_modules,
network or private packages. Namespace ancestor containers reveal no host files.

Exact-case lookup and virtual stat metadata are host policy, not claims about
physical Darwin filesystem case or timestamps. Snapshot metadata serves tool
initialization only, not a measured lifecycle/RSS or product behavior proof.
Source-text provenance records every actual program source and its exact hash.

Unknown requires, writes, watches, timers, source contexts or directory patterns
MUST fail. Denied operations remain sticky even if the compiler catches a thrown
host error. No plugin or ambient configuration is enabled. The parent MUST use
an allowlisted environment without NODE_OPTIONS, NODE_PATH, TS_NODE or TSC
configuration, profile or tracing variables.

Compiler options MUST retain strict:true, noEmit:true, ES2022, NodeNext module
and resolution, types:[node], the exact admitted typeRoots, skipLibCheck:false,
skipDefaultLibCheck:false, noLib:false, allowJs:false and checkJs:false. The worker
uses createProgram and getPreEmitDiagnostics normally. Config/options/syntactic/
global/semantic diagnostics are not filtered, and declaration diagnostics are
included according to the compiler's normal noEmit options. No suppression
directives, hand-written diagnostic success or patched compiler result is allowed.

## Capture and Predicate

The worker MUST write and fsync exclusive raw JSON before evaluating the expected
diagnostic predicate. It records all normal diagnostics, nested message chains,
related information, program identities, lookup identities/counts, options and
before/after guards. It MUST NOT invent a tsc CLI exit status.

T01 requires no diagnostics. Each negative requires exactly its original primary
file, code, categoryError, line, column and message. Every additional primary
diagnostic, including unresolved imports or warnings, fails. Normal property
elaboration information, which the old pretty=false CLI did not display, is
retained: T04/T05 allow zero or exactly one categoryMessage6500 at the exact
limits.d.ts property location/message; other related information fails. Message
chains remain in raw evidence and their full flattened message is compared.

The worker publishes its result after raw capture. Only completed execution,
successful guards/capture and an exact predicate produce normal process exit0.
A mismatch, exception, publication failure, overflow, signal, timeout or any
unexpected/nonzero owned-process exit remains FAIL. A compiler-API negative
diagnostic is ordinary data, not an expected child exit2. Build CLI results are
not reclassified by this protocol.

Oversized raw diagnostics retain a bounded raw prefix, total byte count and full
hash with overflow failure; they MUST NOT produce a match or pass. An original
thrown value is rethrown unchanged after attempted failure capture. Raw capture
failure is never retried or erased by a successful later write.

## Runner Integration

The existing request `api.compile(fixtureId)` MAY remain. Its backend MUST select
only T01–T05 and spawn the exact worker CLI in INTERFACE-PROPOSAL. The response is
`m1b-type-api-result-v2`, not the old code/signal/stdout/stderr CLI result.

The parent MUST retain actual process status, stdout/stderr, timing and known
reap separately; authenticate raw/result bytes and full tool/subject/case guards;
and reject every nonzero or unsafe retirement before returning from api.compile.
It MUST bind fixture/layout/roots/options/result/raw hashes to the sealed request,
not trust a worker's matched:true assertion alone. The adapter durably captures
the result and independently repeats the exact diagnostic predicate.

Other22 case IDs receive the same api and caseId through their original function.
Only the entry mapping changes to the additive dispatcher. Old source/evidence
and CLI protocol remain history, not edited or rescored.

## Bounds

The five fixtures across S/M retain10 type wrappers and10 compiler-API Node
children:20 type children, not10. The API child spawns none. Total mechanical
component remains28 children and peak3 including coordinator, within the existing
global168/peak4. Every API child, capture and cleanup stays inside its wrapper's
single30s/global-minimum deadline. No retry or new time allowance exists.

Per API child, raw and result files are each at most512KiB; stdout/stderr are each
at most64KiB. These1.125MiB fit within the prior2MiB compiler-capture allocation;
parent terminal metadata keeps its existing separate reservation. Adapter IPC
remains within the existing1MiB case reservation. Input request/fixture bytes are
working data, and captures also count toward root's1GiB working ceiling. COSTS
declares a potential shared tool-layout copy, never an unbudgeted extra.

## Test and Validation Matrix

| Obligation | Prepared check | Current state |
| --- | --- | --- |
| Five fixture bytes and intent | Frozen blob/hash equality | DATA authenticated |
| Strict positive/negative diagnostic set | Compiler API plus post-capture matcher | UNRUN |
| No CLI status invention/nonzero waiver | Separate process and API result schemas | SOURCE only |
| Tool/subject/read-root admission | Full maps and snapshot CompilerHost | UNRUN implementation |
| Original22 cases unchanged | Exact source hashes and forwarding table | STATIC binding |
| Source syntax | Presealed node--check commands | Separate static evidence |
| Actual diagnostic/import/guard failure controls | Exact deferred witnesses | UNRUN, no preparation controls |

## Conformance Criteria

This packet is an additive implementation proposal, not complete combined
admission. The runner must integrate/reseal and ROOT must route the one actual
review before any compiler invocation. No runtime/type/compiler pass or full
resource readiness follows from this source seal.

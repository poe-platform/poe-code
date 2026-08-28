# Concrete TYPE and LOADED component: independent static review

Date: August 28, 2026. Role: DIFFERENT verifier, not worker/core/build author.

## Verdict

**CHANGES REQUIRED: two static leaf findings. Core compatibility remains pending.**
This is neither a runnable compound seal nor RootGO. The findings concern actual
leaf branches and existing frozen requirements, not the absence of future runs.
All twenty declared dynamic controls remain UNRUN. Candidate executions,
TypeScript/compiler calls, product loads and runtime/control passes are zero.

Criteria were committed before worker/ABI body inspection. Bodies were inspected
post-candidate and statically, not as unseen precode behavior. No unsealed core or
build body, authored inspector, classifier, adapter or control was invoked/read
as execution. No source fixes or historical result changes were made.

## Authentication and chronology

- Worker evidence: `c0353685540288d504b93f206735fe4c448268ef`.
- Input preseal: `e7472c54d3bacf3431d56e1d7a4458fa7e4b80af`.
- Final seal SHA-256:
  `f5eb6e660f627c6cf1d029682b06f0f9b836b4bc98ccd5bc85c3ec68b811a0e2`.
- SOURCE-PRESEAL SHA-256:
  `9319fd64441c728fba358be8b9def804d6990fc2e1042ee21e4939c3b8944dfb`.
- ABI: `9d582d791336fd66d865f6592b830c39a359d344`, CORE-INTERFACE SHA-256
  `c5e36798741667981f21f002755be3f420fbd6103b8a4b3f8783531a9f6fc412`.

All thirty final committed files, twenty-nine final descriptors plus externally
hash-bound self, authenticate. Twenty-six SOURCE-PRESEAL descriptors match the
final files; all twenty-two input-preseal files remain unchanged. The source
preseal and three executable bodies first enter **c035**, not e747. The worker
handoff correctly calls e747 INPUT_PRESEAL_COMMIT. Its source-prevalidation order
is author-reported, not independently proved by an earlier source-body commit.
This chronology clarification does not invalidate the current sealed bytes.

AUTHENTICATION.json records exact path/blob/hash/length/Git regular class for
every worker file and the ABI. Full mode0644 declarations are seal-bound;
future actual physical copies still require their own strict mode/kind/parent/
membership checks. Historical original POSIX modes are not inferred from Git.

Twenty references are accounted for: nineteen direct committed hash/size checks
and the source archive through accepted dffc DATA evidence. Eleven fixture byte
projections match their40944913 originals. Four full870 maps, README/directories,
three literal transforms and four whole frozen witness objects agree. No DATA
archive cohort was repeated. Only one packaged parser.js payload was read in
memory, after its root raw package hash check, to verify the newly supplied
pending-shadow intermediate hash. Both stages match; no postimage was written.

Three syntax-only Node checks returned0 with empty stdout/stderr. Source was
supplied on stdin under a hash-authenticated Node binary with NODE_OPTIONS and
NODE_PATH absent. This parsed JavaScript but evaluated no authored module and
ran no compiler/worker/control. Raw syntax results are in SYNTAX-CHECKS.json.

## CW-F01: indented extra compiler output is accepted

Severity: medium. Frozen evidence: `CW-F01-STATIC-WITNESS.json`, commit9189eb71.
All worker source anchors below refer to the committed `workers/` root in c035.

`type-worker.mjs:89` parses diagnostics, but `type-worker.mjs:93` ignores **any**
nonempty line starting with two spaces after a recognized diagnostic. Therefore
a matching factory-command-extra TS2554 line followed by an indented extra
warning leaves unexpectedOutput false and diagnostics.length1. The acceptance
branch at `type-worker.mjs:96` selects ACCEPTED_COMPILE_REJECTION/PASS.

The sealed TYPE-04 requirement in `DEFERRED-CONTROLS.json:10` requires warning,
extra-diagnostic or unexpected-output input to FAIL. The benign raw data witness
isolates this branch while assuming earlier provenance/raw-file/reap guards
succeed. It is **static reachability**, not an observed compiler or control run.

Owner action: reject unrecognized indented output. If legitimate multiline TS
diagnostics need continuation support, bind their accepted continuation structure
instead of treating every indented line as harmless. Keep fixture/code/line/file
expectations and raw-before-assert capture unchanged. This needs no YQ semantic
policy change or worker/parent exit-status waiver.

## CW-F02: frozen UTF22 incompleteness becomes pristine failure

Severity: medium. Frozen evidence: `CW-F02-STATIC-WITNESS.json`, commit7d265b20.

The exact UTF22 witness still contains expected.assertions[0], the natural-language
retained-fragment obligation. The sealed runtime-v2 `delta.mjs:15`–`delta.mjs:28`
adds every such assertion to unfulfilled and produces INCOMPLETE. The committed
`CORE-INTERFACE.json:32` requires unchanged F01/CMD22 projection behavior.

Even with normal status0/stdout `[1,2]\n`, the two pristine positive slots at
`loaded-worker.mjs:111`–`loaded-worker.mjs:113` collapse that INCOMPLETE to
FAIL/PRISTINE_WITNESS_FAILURE. The retained-view prerequisite at
`loaded-worker.mjs:72`–`loaded-worker.mjs:74` also requires the unavailable whole
witness BOUND_PROJECTION_ONLY status. Thus four slots have a known binding issue:

| Profile | Positive | Mutant prerequisite |
| --- | --- | --- |
| source-built-direct | LOAD-POSITIVE / UTF22 | MUT-RETAINED-VIEW / UTF22 |
| installed-moved-direct | LOAD-POSITIVE / UTF22 | MUT-RETAINED-VIEW / UTF22 |

This is not an assertion that the repaired candidate fails. The leaf does not
false-green the unknown assertion; it misclassifies the unavailable proof and
cannot complete these four controls under the unchanged ABI. Proper core gating
must keep the two mutant admissions UNRUN before materialization/import, rather
than first running them and later discovering a failed prerequisite. The other
six mutant slots do not contain this particular natural-language assertion.

Owner action: handle INCOMPLETE as an explicit binding gap, not a contradicted
pristine primitive; keep the four affected prerequisites pending in composition.
Do not strip the assertion, return fake BOUND from core, inherit an old PASS or
waive F01. Any future separately scoped primitive proof needs its own explicit
binding without turning whole-record incompleteness green. No such adapter is
authorized or implemented by this review.

## Concrete behavior that agrees statically

TYPE calls are sequential and finite: two direct slots of six fixtures each,
540000ms each, and one480000ms conditional public slot. The public branch at
`type-worker.mjs:114`–`type-worker.mjs:120` produces five UNRUN_EXPORT_GAP results
and calls no compiler. Twelve direct requests plus build1/public5 reserve the
eighteen-compiler maximum. Installed-unmoved is not a third compiler profile.

The generated fixtures/config at `type-worker.mjs:23`–`type-worker.mjs:58` use
exclusive new scratch files, relative bound package entries, explicit copied
Node types, strict NodeNext/noEmit and no diagnostic suppression. They do not
write product sources. The two files are disclosed through generated-type-inputs
before runTool; core enrollment/ancestry/complete resolution guards are required.

At `type-worker.mjs:133`–`type-worker.mjs:145`, raw tool return/prepared inputs are
published before reap, stream-size/hash, provenance, integrity and diagnostic
checks. The reader verifies8MiB combined compiler capture, fatal UTF-8, empty
stderr, exact negative code/line/file and positive column; positive compile needs
code0/empty stdout. Signals/timeouts/overflow/out-of-deadline/code outside0/1/2
cannot become expected-negative success. CW-F01 is the extra-output exception.
Wrong/missing diagnostic/declaration errors remain separate classifications.

Known compiler reap and positive guard precede ordinary classification/next
iteration. Missing reap/provenance/map facts throw unsafe via
`worker-support.mjs:6`. A returned worker PASS is not actual process success:
core alone must capture/reap the outer and parent and make any nonzero/signal/
timeout/overflow override every receipt. Nothing here grants an exception.

LOADED requests exactly one captureSemantic per slot at `loaded-worker.mjs:98`:
ten total future invocations, two positives/eight mutants, over two profiles.
There is no extra baseline invocation. The whole witness is hash-checked and
compared to the bound149 data at `loaded-worker.mjs:86`–`loaded-worker.mjs:91`.
Full maps and variant identity are checked before capture. After core returns
durable capture, raw evidence is recorded before projection/kill classification.

`loaded-worker.mjs:4`–`loaded-worker.mjs:21` requires matching candidate/GO/recipe/
environment/root/variant, factory/invocation, cache-root and authenticated-parent
claims, actual entry/dependency records, exact file bytes/modes and inclusion of
the modified dependency. Non-command completion gets no kill. Bound status/stdout/
diagnostic changes, not hash refusal or a thrown assertion alone, decide the
selected primitive kill. No full-record or public-export success is asserted.

The source imports only builtins and the own support module; all nine called API
methods exist in the sealed ABI. There is no worker spawn, dynamic product import,
process.exit, timer, local clock, retry or deadline reset. Phase/capture/tool/reap
ownership remains core's. The2MiB combined command bound is preserved, not
confused with public16MiB or outer16MiB capture. No cap lowering/state injection.

## ABI compatibility: required, not established by declarations

The following are implementable integration requirements using existing methods;
they are not evidence that any unsealed core already implements them:

| Contract | Actual leaf dependency | Required sealed-core verification |
| --- | --- | --- |
| runTool | type-worker61–71,133–144; RESULT-SCHEMA7 | Copied tool trees and exact argv/cwd/environment; durable raw streams, parent times, timeout/overflow and owned reap; bind the provenance extension absent from the ABI's short return list |
| generated scratch | type-worker23–58; INTEGRATION10 | Enroll exact exclusive files and parent directories; no broad scratch exemption or ambient transitive type resolution |
| materializePackage | worker-support86–96; INTEGRATION12 | Fresh independent source build, full870 strict regular copy/physical moved origin, exact variants and retained cumulative guards; metadata equality alone cannot prove movement |
| captureSemantic | loaded-worker98–104; RESULT-SCHEMA10–13 | Genuine loader/namespace/factory/invocation evidence; normalize facts from the same durable capture and authenticate all referenced bytes; no self-reported loaded flags |
| pristine prerequisite | loaded-worker61–74,116; INTEGRATION11 | Core validates an earlier same-environment same-b8 pristine result BEFORE control admission. Leaf reassertion happens after capture and cannot replace this gate; CW-F02 remains a known gap |
| assertProjection | ABI32; loaded-worker72,111 | Preserve F01/CMD22 and unknown obligations, raw-before-assert; handle INCOMPLETE honestly rather than manufacture BOUND |
| guard/own projections | worker-support49–63,82–96 | Authenticate entire worker/input seal/active plans/maps/fixtures before import and retain mode/hash/parent/added-entry guards; INPUT-PRESEAL is not self-authorizing |
| transport/supervision | ABI38–47; INTEGRATION14,22 | Nonce/sequence/exact receipt checks; bounded IPC, metadata and captures; genuine owned PID/group admission/reap, sticky parent/worker status and no foreign kills |

RESULT-SCHEMA.json refines opaque receipt/loaded bodies and additionally requires
compiler provenance. No new method is invented, and the ABI does not state a
closed additional-properties schema for the runTool return. Nevertheless exact
field production and semantics must be explicitly accepted in the final sealed
core composition; extension prose is not compatibility proof. Missing fields
currently make the leaf fail closed, not provide an alternate fallback.

Type fixture preparation, per-tool capture/classification and guards occur inside
the leaf's operation interval; phase('capture') is emitted only after its loop.
Do not present that event alone as isolated compiler/setup timing. Core must bind
real tool/owner timestamps and enforce reservations/cleanup inside the fixed
540/540/480-second slots, no renewed clocks. The approved24165s remains a ceiling,
not a measured forecast or permission to run. Claimed four-process/IPC/capture/
storage limits require actual core supervision; this leaf source cannot prove
them. Missing observability is a concrete future code check, not new policy.

## Handoff and remaining work

Route CW-F01/CW-F02 to the worker owner for an additive correction; do not edit
this component or prior reports here. Route RESULT-SCHEMA/INTEGRATION constraints
to the core owner and inspect only its separately sealed bodies later. Fresh
core/build/tool/loader/source/worker/root bindings, plus separately authorized
controls and candidate evidence, remain required before any execution GO.

The194/eight-overlap inventory,80/135 missing bindings, old4b219 FAIL/CMD22/31
unfulfilled, original worker artifacts and49afeb86 review remain unrescored.
No source-only allocation proof is promoted to runtime/public behavior. No
author12-group/20-control success is inherited. This bounded review stops without
polling core authors or requesting GO.

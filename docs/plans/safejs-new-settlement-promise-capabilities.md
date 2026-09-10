# Promises first encountered in fulfillment data

## Validated limitation

Read-only probe on main runtime `c6e146fca` (d1628e): an imported Promise
fulfills with `{ left: nested, right: nested }`, where nested is a native Promise
not otherwise present in the original inputs. Guest execution returns
`[left === right, await left]` as `[true, 7]`, but `dump()` rejects the outcome
as live execution state requiring an explicit resume capability.

This is not the already-imported Promise alias bug fixed in `c6e146fca`.
That repair reconnects declared input Promises and deliberately does not make
arbitrary host Promise results serializable.

## Required behavior and checks

Design explicit replay representation for newly encountered Promise values,
without importing native own-property metadata or silently treating pending
execution as completed data. Preserve shared references and cycles, fulfillment
and rejection behavior, observation order, and budget/lifecycle accounting.

Reproduce with failing tests for completed replay without original host inputs,
then cover pending checkpoints, missing resume capabilities, nested Promise
chains, repeated aliases, mutual/self-reference graphs, and invalid serialized
references. Native metadata admission remains a separate policy decision.

Do not assume that replay can simply rerun the original conversion: a restored
parent outcome can reference a nested capability before its wrapper exists.
Reconstruction must respect recorded operation order and avoid unresolved
capability waits that can never be satisfied.

No implementation yet. Main and the RegExp candidate are fixed while their
separate verification sessions (50809 and 87047) run.

## Isolated regressions

Candidate `/tmp/safejs-new-promise-capability.KGfWqD` copies main runtime
`c6e146fca` without the RegExp candidate. Added fulfilled/rejected cases in
`src/run.new-settlement-promise.test.ts`, requiring alias preservation and two
completed replays without original host inputs.

The first run (696497) reproduced the fulfilled dump failure. Its rejection
fixture used a primitive reason and hit existing host-error normalization before
dumping; that is not evidence of a replay failure. The fixture now rejects with
an Error and compares its message, leaving host error policy unchanged.
Both corrected regressions fail specifically at dump with the missing live-state
capability error (5ac7f9). First execution and alias checks pass in both cases.

An isolated prototype marks imported native Promises and permits journal-only
encoding of settled, unmodified imported Promise data. Pending Promises and
unregistered live execution state remain rejected. The fulfilled regression
passes, but rejected replay raises an unhandled rejection (509305), suspected
to originate in validation reconstruction. TypeScript passed (4ed244). This
prototype is not qualified or integrated; investigate observation and pending
checkpoint semantics before broadening it.

Validation reconstruction now observes its temporary imported Promises through
a decode callback, without changing execution-time observation. Both public
fulfilled/rejected repeated-replay cases pass (aad1c5). Added controls for pending
imports, arbitrary unregistered Promises, custom properties, invalid settlement
tags, and continued reporting of unobserved execution rejections. The expanded
selection is running. This remains an isolated settled-data prototype; pending
checkpoint/resume support is still unfinished.
The initial safeguard selection passed 37 tests (b0eb52). Added a public
self-referential fulfillment replay and a malformed direct self-fulfillment
rejection control. The expanded six-file Promise/replay/ordering/compatibility
selection passed 98 tests (6c12a5), and TypeScript passed (10a6f1). Candidate
lint session 10021 is still live. No main source changes or integration yet.
Candidate lint completed successfully (8ae1fe). Fixed-source broad verification
is running as session 26565, covering snapshot, host-call and public Promise
tests; JSON output is `/tmp/safejs-new-settlement-promise-candidate-results.json`.
Keep this candidate unchanged until terminal. Main 50809 and RegExp 21787 were
also confirmed live at the start of this verification.

A read-only main probe requested `dump(execution, { mode: "replay" })` after
the guest reached a newly encountered pending Promise (3a8d64). Checkpoint
capture rejected the nested live state as lacking a resume capability. The
probe then resolved the pending Promise and the original run finished with 7.
This validates the public pending-checkpoint gap without abandoning a live run
or conflating it with completed replay. It is not fixed by settled-data encoding.

## Cross-outcome identity defect in prototype

A read-only candidate probe (345d23) gave two imported input Promises fulfillment
objects referring to the same newly encountered nested Promise. First execution
returned true for equality across the two outcomes; completed replay returned
false. Per-outcome settled-Promise data nodes duplicate that identity because
each journal outcome is decoded with a separate graph memo.

This contradicts completion of the settled replay repair even if session 26565
passes its current selection. Do not integrate the prototype. Add a regression
after the fixed-source run terminates and design journal-wide identity handling.
Shared declarations must validate consistent settlement data and references;
merely accepting a repeated arbitrary identity string could hide contradictory
or malformed snapshot data. Ordinary data-copy boundaries must remain separate.

Session 26565 terminated with 2,364 passing tests across 167 files (407e81).
This does not qualify the prototype: the independently demonstrated cross-outcome
identity defect is absent from that selection and must still be fixed.

## Revalidation and settlement mutation defect

After main's RegExp integration (`daf40cd2a`), the isolated prototype's original
four public tests were rerun: three passed, cross-outcome identity failed again
(3a1142). Expanded that test file with both guest await orders and a control
requiring equal-but-independent Promises and their payloads to stay distinct.
Both await-order cases fail only on replay; the independent control passes.

A further regression establishes a separate settlement-time capture problem:

```js
const payload = { count: 0 };
const source = "const value=await (await input).nested; return ++value.count";
let result = await run(source, {
  bindings: { input: Promise.resolve({ nested: Promise.resolve(payload) }) }
});
// result.returnValue === 1; payload.count === 0
result = await run(source, {
  snapshot: restore(JSON.parse(await dump(result)), { source })
});
// Required: 1. Prototype returns 2.
```

Expanded run 14055 terminated (825d23): four passed, four failed across eight
public cases. The prototype reads the current `promiseStates` value while
encoding the completed journal, after guest mutation. It does not retain an
immutable settlement-time copy. These failures are candidate defects, not
claims that main already supports and incorrectly replays newly found Promises;
main still rejects their missing capabilities at snapshot capture.

The next implementation must solve three connected requirements:

- A journal-wide identity for each newly encountered Promise, including aliases
  reached through distinct outcomes and either guest await order.
- Original settlement data captured before guest mutation, while the live guest
  sees one shared settlement object for one Promise. Equal independent Promises
  and ordinary outer outcome objects must not be merged.
- Pending imported Promise ownership and reconciliation rather than treating a
  live Promise as settled data. The previously validated pending capture gap
  remains open.

Prefer extending the existing journal-owned Promise capability lifecycle over
adding arbitrary repeated identity strings to per-outcome settled data nodes.
`prepareInputPromise` currently assigns journal ownership only while preparing
the initial input graph. Nested imports in later settlements receive bare
`createSandboxPromise` wrappers, explaining why they lack a resume identity.
Any dynamic registration design must preserve deterministic call ordinals,
validate all reference declarations, support restoration without original host
inputs, and account for retained settlement data and disposal. Do not integrate
the current settled-data prototype or infer success from its earlier broad run.

## Isolated settlement-time capture experiment

The prototype now keeps a separate imported settlement snapshot when the native
Promise settles, before guest reactions mutate the exposed value. The snapshot
uses data cloning with shared-buffer snapshots; ordinary Promise state remains
live. A failed capture is retained as a snapshot error, not converted into an
execution rejection. Retained-data traversal includes captured settlement data.
Replay encoding reads this original snapshot instead of current Promise state.
Decoded settlements capture after graph initialization, supporting immediate
re-encoding and cyclic data without depending on another microtask.

The public counter regression changed from 2 on replay to the required 1.
Added checks for immediate re-encoding, original array data and measured retained
storage, and copied shared-buffer bytes. Immediate re-encoding initially failed
(fa7a60), then passed after restore-time capture. The first shared-buffer fixture
used an unsupported raw native SAB and failed before the capture path; it was
corrected to use maintained branded storage. Do not claim that fixture failure
as evidence for the shared-storage capture defect.

Expanded seven-file run 37435 terminated (ae4f81): 92 passed, three failed.
The failures are the original cross-outcome Promise equality case and both
await-order shared settlement cases. TypeScript passed (f407d2). Scoped lint is
still running as session 24229; keep the candidate fixed until it terminates.
This experiment is not main code and is not qualified for integration. Pending
resume, journal-wide identity, compilation ownership, retained-data budget
enforcement and disposal still need end-to-end validation. Main stays at the
RegExp repair plus investigation documentation; no push or release occurred.

## Canonical cross-outcome references experiment

Settlement-capture lint session 24229 passed (b81d66). A low-level canonical
reference regression then failed against the unchanged prototype (41f604).
The isolated replay graph format now supports an imported-Promise reference to
one canonical `(callId, node)` declaration. Encoding retains a per-journal
Promise identity map; decoding uses a Promise-only memo shared across outcome
graphs. It does not reuse ordinary object memos across outcomes. References
must target a declared settled-imported-Promise node, and malformed outcomes
are decoded/validated rather than replaced with arbitrary shared identity text.
The journal retains reconstructed Promise roots and clears its memo on disposal.

The original three identity regressions now pass alongside mutation-safe replay
(24 tests, bcf60e). Added mutually referring newly imported Promises reached in
reverse await order, missing/non-Promise declarations, invalid node references,
and malformed canonical outcomes. Expanded seven-file selection passed all
105 tests (bc7a28). During that selection a TypeScript narrowing fix captured
`input.calls` as a local before its resolver callback; this was not a fixed-source
qualification. Refreshed TypeScript passed (470d65). Scoped lint session 85719
is running. A new fixed-source broad snapshot/host-call/Promise selection writes
`/tmp/safejs-canonical-promise-replay-results.json`; no candidate runtime or test
edits are permitted until it terminates. This candidate still excludes main's
RegExp import change and remains unqualified for integration. Pending checkpoint
reconciliation, cross-graph nesting limits, budget enforcement and disposal
require further validation; green focused tests do not prove those requirements.
The fixed-source broad selection is session 77606; continue polling this handle
rather than restarting a quiet run.

## Cross-graph depth reproduction while qualification runs

Scoped lint passed (50d9f5). Session 77606 remains live (6b5035), so no candidate
source edits were made. An external read-only probe
`/tmp/safejs-promise-depth-probe.mts` generates canonical Promise graphs whose
fulfillment objects point to the next graph. It exercises the decoder directly
with a shared Promise memo and graph resolver; no guest or host filesystem
mutation occurs inside the tested code.

Probe 3d1cf7 accepted 100 declarations. Chains of 600 and 1,100 declarations
both failed after 276 reconstructed declarations with native `RangeError:
Maximum call stack size exceeded`. The cross-graph branch recursively invokes
`decodeReplayData`, resetting its local depth counter each time. Each individual
graph is shallow, so per-graph validation does not bound the combined graph.
This is an independently validated candidate defect; even a green session
77606 cannot qualify integration until it is fixed.

Next repair must avoid native recursive graph expansion and enforce the existing
combined graph-depth semantics, preserving supported shallow graphs and cycles.
Do not introduce an arbitrary smaller maximum merely to avoid the stack error.
Add regression coverage after the fixed-source run is terminal, including a
supported chain, an over-limit chain with a controlled error, and cyclic
cross-graph references. Ensure deferred reconstruction keeps compilation scopes
alive through initialization and does not settle promises from partially
validated graphs. Pending checkpoint reconciliation remains separately open.
Boundary follow-up d286a6 accepted 250 declarations but failed at 300 and 512,
again after 276. The problem therefore is not confined to the largest probe.
Session 77606 was still live in aa4325, including successful execution of all
nine new public Promise regressions; the combined run is not yet terminal.

## Queued cross-graph reconstruction candidate

To preserve fixed sources for session 77606, copied the candidate into
`/tmp/safejs-promise-depth.bKyGJi` and added three depth/cycle regressions there.
Vitest's larger available stack let its baseline accept the 600-declaration
over-limit chain, so the controlled-limit regression failed (b92c58); the
standalone probe had instead overflowed earlier. Both demonstrate missing
combined-depth enforcement, not a stable native stack-size threshold.

The depth candidate replaces recursive initialization with shared work queues.
Cross-graph decode creates Promise placeholders and enqueues their settlement
initializers; the owning decoder drains the queue iteratively. Logical depth
is carried across graph boundaries rather than reset. Compilation scopes stay
alive through initialization, capture, detachment and ticket forwarding, and
are disposed in reverse order. Promise settlement is deferred until validation
and capture finish. Failed reconstruction rolls back newly registered memo
entries without deleting existing entries.

All 32 focused tests passed (fdfe65). Standalone probe e68bf4 now accepts 300
and 512 declarations and rejects 600 and 1,100 with `TypeError: Replay data
exceeds the nesting limit.`, leaving zero memo declarations after failure.
The six-file replay-data, graph-extension, compile-ownership and Promise
selection passed 67 tests (52b2d2); TypeScript passed (7c25f3). Scoped lint is
running as session 23060. This remains an isolated candidate, not main code.

Meanwhile the earlier fixed-source session 77606 terminated successfully
(3c763c): 2,566 tests across 174 files. That result excludes the depth repair
and does not supersede the independently validated recursion defect. Its JSON
report remains `/tmp/safejs-canonical-promise-replay-results.json`.

## Combined RegExp and Promise candidate; capture ownership

Depth-candidate lint passed (db40e5). Its fixed-source broad run is session
34003, writing `/tmp/safejs-queued-promise-replay-results.json`; it was still
live in fc1ee5. Keep `/tmp/safejs-promise-depth.bKyGJi` unchanged until terminal.
A read-only decoder resource probe (26ca4e) rejected oversized regex settlement
data under stringLength, steps and dataSize limits. Failed attempts left no
declarations/tickets, and scope cleanup left zero retained data. Unlimited
decode/capture owned two tickets and cleaned both up.

The earlier candidate directory `/tmp/safejs-new-promise-capability.KGfWqD`
was idle after 77606. Transferred the queued-depth change into it, then applied
main's RegExp import changes there (not to main). The first patch attempt
rejected differing import context without modifying those files; the reviewed
retry preserved the Promise additions. Combined tests passed 79 cases (0c75bc).

A direct native-import probe then exposed an ownership gap not covered by the
decoder probe: a direct regex import cost 193 steps and one ticket; importing
the same regex through a Promise still cost only 193 steps and one ticket,
despite separately compiling its captured settlement snapshot (bfe8b3).
The snapshot copy lacked the importing compilation owner. A regression using
maxSteps=250 failed to report the second compilation (0cb013).

The combined candidate now passes the import compile owner from values and the
host bridge into settlement capture. Capture uses a temporary owned compile
scope, measures the retained copy against the budget, and always releases its
temporary tickets. Its capture failure remains a snapshot error instead of
silently changing the imported Promise's outcome. All 80 focused tests passed
(7ceed6), TypeScript passed (0ece93), and the probe now charges 386 steps for
the Promise import plus capture versus 193 for the direct import (695089).
The temporary capture ticket is released, leaving the original import ticket
owned by the caller scope. Scoped lint is running for the changed capture files.
This combined candidate still requires broad fixed-source qualification and
maintained main build/testing before any local integration commit. Pending
imported-Promise reconciliation remains a known separate limitation. No push,
release, or main runtime change occurred in this experiment.
The depth-only session 34003 subsequently terminated successfully (0487b5):
2,569 tests across 175 files. The combined candidate's refreshed broad run writes
`/tmp/safejs-combined-promise-regexp-results.json`; keep its runtime and tests
unchanged until that run is terminal.
Combined fixed-source broad run is session 60117. Capture-owner lint session
2906 terminated successfully (0255da). The broad run was still live in 953d49.

## Pending import checkpoint regression

After depth-only qualification was terminal, added
`run.pending-imported-promise.test.ts` only to the idle depth candidate
`/tmp/safejs-promise-depth.bKyGJi`. The combined candidate remains unchanged.
The new public test waits for a guest boundary after the outer Promise settles,
captures `dump(execution, { mode: "replay" })` while the nested imported Promise
is still pending, then requires restore without the original input and exactly
one external-reconciliation proof. Its finally block releases the original
Promise and verifies that the original execution finishes with 7.

Baseline session 95542 failed at checkpoint capture with the missing resume
capability error (72ec8d); the reconciliation portion is not yet reached. This
is a maintained failing regression in an isolated copy, not a passing resume
test or a main implementation change.

Inspection confirms initial-input preparation assigns registered wrappers only
to the initial graph, and ordinary host-call restoration consumes consecutive
call ordinals. Blindly registering late-discovered Promises as new ordinary
calls during replay risks changing that order or waiting for a capability that
no replay path will construct. A nested declaration associated with its owning
journal outcome can preserve canonical identity without reissuing the parent
effect. It must still validate reconciliation proofs, deduplicate aliases,
handle cancellation and repeated checkpoints, and retain/clean up its outcomes.
This design direction is not implemented or proven by the current regression.

## Main integration of completed replay

Combined session 60117 terminated successfully (3e768e): 2,781 passed across
189 files, including snapshot, Promise and regex coverage, with candidate
runtime/tests fixed throughout. Main's relevant runtime files had no overlapping
uncommitted edits. Transferred the regression tests first: 21 failed and 11
passed across three files against unchanged main (905368); the separate capture
budget regression also failed with the missing capability error (518878).
Reviewed the five runtime diffs and then applied the qualified candidate to main.

Main-side focused tests are session 15086, maintained selected-workspace build
is 8885, and scoped lint is 17673. README now states completed nested-Promise
replay support, original settlement capture, alias/cycle/depth behavior and the
remaining pending-checkpoint limitation. No pending implementation or pending
failing test was transferred to main. Main integration is not yet committed;
await these checks before the local-only atomic commit. A full package gate
still needs to distinguish existing unresolved failures from regressions.
Main focused checks passed all 92 tests (0d03af). All nine transferred runtime
and test files match the 2,781-test qualified combined candidate byte for byte
(ffc9e2). Maintained workspace build passed its 23 declared build tasks and all
five built-import checks (c12834); scoped lint passed (5b32b8). Whitespace checks
passed. The change is nonvisual runtime behavior, so no CLI screenshot applies.
The atomic local commit contains only these edited files, README and this plan;
unrelated staged Safe Bash files are excluded. No push or release is authorized.

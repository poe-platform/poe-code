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

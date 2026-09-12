# Reproduced mismatch samples and category ownership

**Provenance note:** each section names its cohort. Initial-cohort samples remain diagnostic leads until matching baseline-v2 variants are explicitly reconciled below. No old-cohort result enters replacement totals.

The initial samples use frozen manifest `996bd64baf24588e1639366b76eb272f43328f06701b80a4e144a5730824ee29`, source SHA `f314e261c96e444b8fc983117864462171db5bc4` plus its recorded working-tree content hash, Node `v22.23.2`, ICU `78.2`, V8 `12.4.254.21-node.56`. No runtime fixes are included in this runner task.

## Deleted eval-global Annex B function binding

Classification: reproduced semantic discrepancy in an implemented Annex B path; not a host-capability failure or runner defect. Annex B web-legacy requirements are tracked separately from mandatory core-edition requirements. Category owner: global/eval binding semantics, principally `packages/safe-js/src/interp/scope.ts` and the function-declaration evaluation path in `packages/safe-js/src/interp/interpreter.ts`.

Pinned failing fixture: `annexB/language/eval-code/direct/global-if-stmt-else-decl-eval-global-init.js#sloppy`; original source SHA-256 `772082e8e31b447b9bfe72995f82563c124703656e0adde0e31231567304ae89`. Completed batch `00500-00999.jsonl` records `failed/unexpected-throw`, runtime `ReferenceError`, message `Cannot assign to undeclared binding 'f'.` The fixture's `verifyProperty` checks configurability by deleting the global `f` property; the subsequently evaluated Annex B function declaration must assign the function value again.

Smallest reproduced trigger retained from that path:

```js
eval("delete globalThis.f;if(false);else function f(){}");typeof f
```

Expected: normal completion with `"function"`. Actual: the ReferenceError above. Neighboring passing control removes the deletion:

```js
eval("if(false);else function f(){}");typeof f
```

Observed control: normal completion with `"function"`. Pinned neighboring passing fixture in the same completed batch: `annexB/language/eval-code/direct/global-if-stmt-else-decl-eval-global-existing-var-update.js#sloppy`.

Primary published-edition contract, fetched directly from ECMA-262 edition 16 (2025):

- [B.3.3 FunctionDeclarations in IfStatement Statement Clauses](https://262.ecma-international.org/16.0/#sec-functiondeclarations-in-ifstatement-statement-clauses) applies the synthetic-block legacy semantics.
- [B.3.2.3 Changes to EvalDeclarationInstantiation](https://262.ecma-international.org/16.0/#sec-block-level-function-declarations-web-legacy-compatibility-semantics) creates a configurable global binding and later assigns the function through `SetMutableBinding` with strictness false.
- [9.1.1.2.5 Object Environment Record SetMutableBinding](https://262.ecma-international.org/16.0/#sec-object-environment-records-setmutablebinding-n-v-s) permits setting a missing binding-object property when strictness is false; the missing-property ReferenceError condition requires strictness true.

The specification, not a native engine, supplies the expected result. This is a repair candidate for the binding owner; it does not justify changing the qualified runner or excluding the fixture.

Reproduction command (executed September 11, 2026, same environment above):

```sh
node --import tsx --input-type=module <<'JS'
import {createTest262Realm} from './packages/safe-js/test/conformance/realm.ts';
import {classifyScriptOutcome} from './packages/safe-js/test/conformance/result.ts';
for (const source of [
  'eval("delete globalThis.f;if(false);else function f(){}");typeof f',
  'eval("if(false);else function f(){}");typeof f'
]) {
  const realm = createTest262Realm({deadline: Date.now() + 3000});
  try {
    const outcome = await realm.evaluate(source);
    console.log(JSON.stringify({source, outcome: outcome.status === 'normal' ? outcome : classifyScriptOutcome(outcome)}));
  } finally { await realm.dispose(); }
}
JS
```

No unit regression or fix was added during the frozen corpus run. A future repair must first preserve this failing trigger and its passing control in a fast in-memory regression.

## Array.fromAsync rejection identity: newer fixture contract pending mapping

Classification: reproduced implementation discrepancy against a pinned newer-API fixture; **not an ECMA-262 edition 16 defect claim**. Direct inspection of the published edition found no `sec-array.fromasync` clause. The canonical evidence separately pins Temporal, upsert, and Atomics.pause; this review does not add Array.fromAsync to that target. Its full-corpus results remain counted, with edition/extension-contract reconciliation explicitly pending.

Pinned representative: `built-ins/Array/fromAsync/asyncitems-arraylike-length-accessor-throws.js`, tagged `features: [Array.fromAsync]`, `esid: sec-array.fromasync`; the baseline records `async-failure`. Category owner: `packages/safe-js/src/interp/globals/object-array.ts` (`fromAsync`) and promise/error propagation. Assertion metadata expects rejection on an abrupt array-like `length` getter. A neighboring direct Promise rejection preserves identity.

Reproduced sources, using `createTest262Realm({deadline: Date.now()+3000}, message => prints.push(message))`, then `evaluate`, `settle`, and `dispose`:

```js
const error=new Error("x");
Array.fromAsync({get length(){throw error}}).catch(e=>print(e===error));
// observed print: "false"
```

```js
const error=new Error("x");
Promise.reject(error).catch(e=>print(e===error));
// observed print: "true"
```

```js
Array.fromAsync({length:1,0:42}).then(a=>print(a[0]));
// observed print: "42"
```

All three evaluator outcomes and settlement outcomes completed normally; the discrepancy is the observed identity comparison, not a host timeout. These probes do not rewrite the fixture or count its failure as a pass. A repair remains blocked on its category owner's exact public/extension contract mapping and a failing regression; the runner remains unchanged.

## Array callback/resizable-buffer deadline nonpasses

Classification: retained budget/deadline nonpass, with full semantic coverage **unproven**. Category owners: bounded execution/performance (`packages/safe-js/src/interp/budget.ts`) and Array/typed-array iteration (`packages/safe-js/src/interp/methods/array.ts`, `packages/safe-js/src/interp/globals/numeric-typed-array.ts`). A timeout alone does not identify an ECMAScript semantic defect or prove a host-native backend limitation.

Representative pinned fixture: `built-ins/Array/prototype/find/resizable-buffer-grow-mid-iteration.js`, `esid: sec-array.prototype.find`, feature `resizable-arraybuffer`. It repeats four view-shape scenarios over all constructor entries supplied by the unchanged `resizableArrayBufferUtils.js` harness. The baseline records `failed/host-error` with `code: budgetExceeded`, `budget: deadline` under the original 3,000 ms allowance. No larger allowance was tried or substituted.

A small extracted constructor/view control completed in approximately 42 ms under the same 3,000 ms deadline:

```js
const b=new ArrayBuffer(4,{maxByteLength:8});
const a=new Uint8Array(b);a.set([0,2,4,6]);
const seen=[];
const result=Array.prototype.find.call(a,(v,i)=>{
  seen.push(v);if(i===1)b.resize(8);return false;
});
[result,seen.join(",")]
// normal completion: [undefined, "0,2,4,6"]
```

The passing one-constructor control shows that this path is executable; it does not qualify the full timed-out constructor matrix. Pinned neighboring pass: `built-ins/Array/prototype/find/array-altered-during-loop.js` in both modes, source SHA-256 `e03d778ac8de4da83ce1252bf6aec2f9e7e3aef6f0ef54daf74daa74cc2040a5`. Full fixture failures remain nonpasses and assigned performance/semantic qualification work.

## Baseline-v2 reconciliation of the sample leads

The first four completed replacement reports were independently checked against manifest `9436612867dbba331f104f0d3cd8e7f6f649e972fcdc695b21f25d87b53c0c94`, excluding all old-cohort and smoke reports. The complete replacement run is still pending.

- `baseline-v2/batches/00500-00999.jsonl` again records the exact Annex B eval-global fixture as a sloppy-mode runtime ReferenceError with the same message. Its original and variant source hash match the sample above. The current same-category `block-decl-nostrict.js#sloppy` is a recorded pass.
- `baseline-v2/batches/01000-01499.jsonl` again records both Array.fromAsync fixture variants as `failed/async-failure`. The current same-directory `async-iterable-async-mapped-awaits-once.js` passes both modes. The newer-API/edition-contract distinction remains unchanged.
- The find/resizable example will be reconciled only after its replacement selection has a valid terminal summary; no first-cohort timeout is substituted for it.

The independently reconciled replacement prefix currently covers 2,000 files and 3,181 variants: 2,952 passes, 151 failures, and 78 unsupported. This is an explicitly partial checkpoint, not the final complete baseline total.

## Guest generator state validation versus host reentry protection (baseline-v2)

Current provenance: manifest `9436612867dbba331f104f0d3cd8e7f6f649e972fcdc695b21f25d87b53c0c94`, source-content SHA-256 `babb6a32e2a69931606306fe865366da0fd52a3d368c220b314b8f83a80321cc`, source SHA `f314e261c96e444b8fc983117864462171db5bc4`, Node `v22.23.2` / ICU `78.2` / V8 `12.4.254.21-node.56`.

Six retained nonpasses in the completed `baseline-v2/batches/07000-07499.jsonl` are the two modes of `built-ins/GeneratorPrototype/{next,return,throw}/from-state-executing.js`. Each reports `failed/host-error`, `code: reentry`, and `Sandbox object is already running.` These tests require a catchable guest TypeError when resuming an executing synchronous generator, then verify its resulting completion state.

Classification: **guest-generator state/host-guard separation candidate**, not an unavailable host capability or an undifferentiated backend failure. The host reentry guard is intentional and must remain protected. The discrepancy is that a purely guest operation reaches that fatal guard rather than the required guest GeneratorValidate TypeError. This does not authorize weakening host authority or reentry policy.

Primary contract: [published ECMA-262 edition 16, §27.5.3.2 GeneratorValidate](https://262.ecma-international.org/16.0/#sec-generatorvalidate), directly fetched and inspected: step 6 specifies TypeError for the executing state. No native-engine result was used as the normative oracle.

Owner: generator state validation and host-guard integration, principally `packages/safe-js/src/interp/iteration.ts` (`generatorIterator`), `packages/safe-js/src/interp/methods/generator.ts`, and `packages/safe-js/src/interp/running-state.ts`. Source inspection shows `generatorIterator` calls `enterRunningState(generator)` before dispatching the channel; the shared guard throws SandboxError on recursive entry. Existing raw-channel guard tests deliberately expect that host protection, so any later repair must distinguish the guest operation without removing the guard.

The following current-runtime probe completed quickly under the unchanged 3,000 ms deadline:

```sh
node --import tsx --input-type=module <<'JS'
import {createTest262Realm} from './packages/safe-js/test/conformance/realm.ts';
import {classifyScriptOutcome} from './packages/safe-js/test/conformance/result.ts';
for (const source of [
  'function* g(){it.next()}const it=g();let caught=false;try{it.next()}catch(e){caught=e instanceof TypeError};caught',
  'function* g(){yield 1}const it=g();[it.next().value,it.next().done]'
]) {
  const realm=createTest262Realm({deadline:Date.now()+3000});
  try {
    const outcome=await realm.evaluate(source);
    console.log(JSON.stringify({source,outcome:outcome.status==='normal'?outcome:classifyScriptOutcome(outcome)}));
  } finally {await realm.dispose();}
}
JS
```

Expected first completion: `true` (the guest catches TypeError). Actual: fatal host-error/reentry bypasses that guest catch. Neighboring ordinary-generator control: normal completion `[1, true]`. The full original fixtures remain failures; the reduced probe does not qualify their later completion-state assertions. No runtime code or tests were changed during the frozen run.

### V2 unhandled rejection policy is not a qualified Test262 verdict

The frozen runner records every settlement rejection as `failed/unhandled-rejection`. This is a conservative **unqualified-rejection-policy** nonpass, owned by `verify-conformance-oracles` in `test/conformance/execute.ts` and `realm.ts`; it must not be presented as an ECMAScript defect. No result is retrospectively converted into a pass. Full policy qualification remains unresolved even when the complete baseline has no omitted variants.

Pinned [INTERPRETING.md, Test Results and async](https://github.com/tc39/test262/blob/419d3e0a2273ba01a3bfcbec423f2801425b8e93/INTERPRETING.md#test-results) defines synchronous normal completion as passing and asynchronous completion through the harness marker. It does not equate an unobserved rejected Promise with an uncaught script exception. [Published ECMA-262 edition 16, §27.2.1.9 HostPromiseRejectionTracker](https://262.ecma-international.org/16.0/#sec-host-promise-rejection-tracker) defines a host hook returning UNUSED; its default does nothing. Thus blanket fatal rejection accounting adds a runner policy beyond the pinned oracle. It is not an intentional missing ECMAScript capability.

At 30 terminal V2 reports (15,000 files / 28,956 variants), there are 54 such nonpasses: 46 without `async`, eight with `async`. These are interim counts; the final inventory is authoritative. `Promise/any/returns-promise.js` and `ctx-ctor.js` deliberately inspect the Promise returned for an empty input without handling its rejection. `Promise/all/invoke-resolve-error-close.js` deliberately causes rejection and then checks a synchronous iterator-close count. Both modes remain raw nonpasses in the baseline. `Promise/prototype/then/rxn-handler-{fulfilled,rejected}-next-abrupt.js` deliberately rejects one reaction while another calls successful `$DONE`; these account for four async nonpasses. Merely restricting strict rejection handling to async tests would therefore not qualify the policy.

The other four async records observed here are Array.fromAsync fixtures with a rejected `assert.throwsAsync` assertion (`Expected a Test262Error ... got a Object`), including `non-iterable-input-element-access-err.js`. Their diagnostics are semantic candidates requiring separate oracle/target review, not evidence that all unhandled rejections are harmless. The fixture invokes `assert.throwsAsync` without awaiting its returned Promise, which also illustrates why removing all rejection accounting would lose useful diagnostics.

Reproduction on the same frozen V2 source SHA/content hash and Node/ICU stated above, unchanged 3,000 ms budget:

```sh
node --import tsx --input-type=module <<'JS'
import {executeTest262} from './packages/safe-js/test/conformance/execute.ts';
for(const source of [
  'Promise.any([]);',
  'Promise.any([]).catch(()=>{});',
  '/*---\nflags: [async]\n---*/\nPromise.any([]);print("Test262:AsyncTestComplete");'
]) {
  const started=Date.now();
  const result=await executeTest262('policy-probe.js',source,{
    harness:new Map([['assert.js',''],['sta.js',''],['doneprintHandle.js','']]),
    timeoutMs:3000,mode:'sloppy'
  });
  console.log(JSON.stringify({source,result,elapsedMs:Date.now()-started}));
}
JS
```

Actual first/third: failed/unhandled-rejection, AggregateError, 60/37 ms. Neighboring handled rejection: passed, 33 ms. Expected under the pinned completion contract: normal synchronous completion and successful async marker respectively. This reduced probe explicitly uses empty harness adapters because it invokes no harness assertions; it does not replace execution of the original pinned fixtures. Source inspection, fixture results, and reduced reproduction agree on the policy mismatch. No runtime or runner code was altered during this audit.

### V2 dynamic-import fixture resolution remains unqualified

The mismatch inventory routes failures under `language/expressions/dynamic-import/` to `qualify-source-modules`, retaining their original statuses and diagnostics. These script variants are distinct from the explicitly unsupported module mode. For example, pinned `assignment-expression/additive-expr.js` imports two adjacent `_FIXTURE.js` modules and checks their exported values; the V2 runner reports async failure. Source inspection confirms `createTest262Realm` passes no module resolver or fixture-loading authority to `interpret`. This is a module-fixture qualification candidate, not evidence that AdditiveExpression semantics are defective. The inventory retains actual neighboring passing controls, which can test argument evaluation or rejection behavior without successfully loading a module; those controls do not qualify module loading. Full source/asset hashes remain in the manifest, and neither these failures nor the explicit module nonpasses are filtered from totals.

### Dynamic-import raw passes require a conservative qualification overlay

The pass audit found a concrete false qualification: `language/expressions/dynamic-import/import-errored-module.js` passes in both modes because it only checks two rejected Promises against constructor `Error`. Its existing adjacent fixture throws `Error("boom")`. The runner instead rejects before loading any file with `Unknown module './import-errored-module_FIXTURE.js'. No modules are registered.` Thus the cached errored-module evaluation contract is never exercised. This is a runner module-qualification blocker, not a runtime language repair claim. The explicit host boundary must not be weakened.

Primary contracts are [edition 16 §13.3.10.3 ContinueDynamicImport](https://262.ecma-international.org/16.0/#sec-ContinueDynamicImport) and [§16.2.1.10 HostLoadImportedModule](https://262.ecma-international.org/16.0/#sec-HostLoadImportedModule), together with the pinned fixture's intended module loading. Host loading may reject, but a generic denial does not evidence evaluation or caching of an existing Test262 fixture. A broad catch can satisfy the fixture's assertions for the wrong reason.

The current `dynamic-import-pass-audit.json` records 909 raw passes individually by filename, mode and source hash: 717 parse negatives without module evaluation; 102 syntax-only tests with unexecuted import expressions; 54 argument/attribute validation checks before host resolution; two argument-order checks that ignore the eventual host rejection; 32 missing-file catches relying on the denied resolver; and the two existing errored-module cases above. The last 34 are conservatively **qualified nonpasses** while their immutable raw status remains passed. The other 875 evidence only their stated grammar/argument scope, never module loading. Final inventory must subtract the 34 from any qualified-pass ceiling and keep them visible alongside module/agent gaps; raw total reconciliation alone is not task acceptance.

Smallest current diagnostic probe: evaluate `import("./import-errored-module_FIXTURE.js").catch(e=>print(e.message));` with `createTest262Realm({deadline:Date.now()+3000})`, then settle. It prints the no-registered-modules message and completes normally. The neighboring pre-host control `assign-expr-get-value-abrupt-throws.js` passes by checking exact Test262Error/ReferenceError from argument evaluation, before resolution can occur. The execution agent independently reproduced the pinned false pass and added an error-message assertion expecting `boom`, which failed in both modes; its separate receipt contains the full commands. No frozen source was modified.

V2 disposition was subsequently tightened: the concrete false qualification requires a runner gate and a fresh V3 corpus execution. The proposed V2 overlay is diagnostic historical evidence only, not an accepted final measurement. Non-parse tests declaring dynamic-import, import-defer, source-phase-imports or source-phase-imports-module-source require conservative unsupported module outcomes until their adapter is qualified. Independent metadata census found 595 non-module files / 1,153 variants in that union, including three source-phase tests without dynamic-import metadata. A full corpus literal import-call candidate scan outside that union found only reserved-word `get import()`/`set import()` property names; this lexical audit is supporting evidence, not a proof about arbitrary untrusted metadata. ShadowRealm has 64 files / 124 variants and no implemented global or harness adapter, so its runtime cases also require explicit capability qualification. No WebAssembly/Wasm feature tests were enumerated. Source/module assets remain hashed and no host authority is granted by these gates.

ShadowRealm audit correction: absence of this newer proposal builtin alone does **not** justify a host capability gate. All 64 enumerated ShadowRealm files were observed in V2: zero passes, 120 failures and four module-unsupported variants. Thus there is no qualified `importValue` false pass to repair. Preserve these diagnostics as a newer-API contract/target-mapping gap; ShadowRealm is neither in published edition 16 nor one of the explicitly tracked Temporal/upsert/Atomics.pause extensions. The earlier proposed ShadowRealm gate above was rejected after this distinction was checked. No ShadowRealm implementation or runner gate is requested.

### Final V3 sample disposition cross-check

After all 216 V3 selections completed, `baseline-v3/sample-disposition-crosscheck.json` revalidated these original pinned fixtures against the final manifest `b974f63562bfa3431a18d4da5113a2a0f05ee919c08016df82d5eab78c99bacd` and content hash `b51f268c45c0643879c5c46eb088618a8db0415020c65e2e32ae47d8b928c9cc`: Annex B deleted eval-global binding remains an unexpected-throw nonpass; Array.fromAsync error identity remains async-failure in both modes; generator recursive next remains host reentry in both modes; Promise.any empty-input descriptor test remains an unqualified rejection-policy nonpass; the formerly false-qualified errored-module import is now explicitly unsupported/module; and the huge Array.push fixture is hard-wall-timeout in both modes. Each receipt includes current result diagnostics, upstream hashes and neighboring controls from final reports. These cross-checks validate current dispositions; earlier reduced probes remain revision-tagged historical diagnostics rather than new runtime repairs.

Final unhandled-rejection counts are 74: 50 synchronous and 24 asynchronous, of which six carry assertion diagnostics. These supersede the interim counts above. The complete detailed inventory and final task-owner counts are in `baseline-v3/inventory-summary.md` and its compressed JSON companion. The full baseline remains unsuccessful, with every nonpass retained.

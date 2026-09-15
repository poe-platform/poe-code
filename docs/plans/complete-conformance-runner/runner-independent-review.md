# Independent runner review

Source SHA: `f314e261c96e444b8fc983117864462171db5bc4` plus the frozen working-tree runner represented by manifest `996bd64baf24588e1639366b76eb272f43328f06701b80a4e144a5730824ee29`. Environment: Node `v22.23.2`, ICU `78.2`, V8 `12.4.254.21-node.56`. Review date: 2026-09-11 (America/Chicago). No runtime or runner sources were edited during this review.

## Contract inspection

Primary contract: [pinned Test262 INTERPRETING.md](https://github.com/tc39/test262/blob/419d3e0a2273ba01a3bfcbec423f2801425b8e93/INTERPRETING.md), read directly from the verified local checkout at `/private/tmp/safejs-baseline-test262-419d3e0/INTERPRETING.md`.

- Raw tests prohibit harness evaluation and source modification. The separate host-defined functions contract still requires global `print` and `$262`; providing these bindings to raw tests is correct.
- Harness includes must run in specified order. `prepareTest262` preserves occurrences and `executeTest262` evaluates each occurrence; the corpus loader only caches file contents. There is no silent evaluation deduplication.
- Negative classification is based on the thrown exception's constructor name and specified phase, not the `.name` property. Reading constructor data without executing guest getters follows the chosen reporting boundary. The existing getter regression passes.
- Modules, agent/shared-memory, blocking mode, IsHTMLDDA, and actual unavailable GC use remain explicit capability nonpasses. Missing authority is not classified as an ECMAScript product defect.
- Cooperative sandbox cancellation cannot forcibly preempt a synchronous host operation. An external bounded-process supervisor is required for such hangs. No hard-preemption claim is made from the Promise.race timer.

These are source/contract inspection conclusions, not claims that every runtime feature has passed its fixtures.

## Executed orchestration probes

The following commands use synthetic, in-memory test source and minimal harness bindings solely to probe runner accounting. They do not alter or replace any harness used by the pinned corpus run.

```sh
node --import tsx --input-type=module <<'JS'
import { executeTest262 } from './packages/safe-js/test/conformance/execute.ts';
const harness = new Map([
  ['assert.js', ''], ['sta.js', ''],
  ['doneprintHandle.js', 'function $DONE(error){print(error ? "Test262:AsyncTestFailure:"+error : "Test262:AsyncTestComplete")}']
]);
for (const count of [0, 10, 100, 1000]) {
  const source = '/*---\nflags: [async, onlyStrict]\n---*/\nlet p=Promise.resolve();for(let i=0;i<' + count + ';i++)p=p.then();p.then(()=>{throw 42});$DONE()';
  console.log(count, JSON.stringify(await executeTest262('late.js', source, {
    harness, timeoutMs: 3000, budget: { maxSteps: 100000 }
  })));
}
JS
```

Observed: lengths 0, 10, 100 each produced `failed/unhandled-rejection`, with runtime thrown number `42`. Length 1000 produced `failed/host-error`, `budgetExceeded/deadline`. No false pass was reproduced; the long-chain control exhausted the unchanged deadline and therefore does not establish its eventual guest rejection behavior.

```sh
node --import tsx --input-type=module <<'JS'
import { executeTest262 } from './packages/safe-js/test/conformance/execute.ts';
const harness = new Map([
  ['assert.js', ''], ['sta.js', ''],
  ['doneprintHandle.js', 'function $DONE(error){print(error ? "Test262:AsyncTestFailure:"+error : "Test262:AsyncTestComplete")}']
]);
const cases = [
  'async function never(){try{await new Promise(()=>{})}finally{await new Promise(()=>{})}}never();$DONE()',
  'Promise.resolve().then(function loop(){return Promise.resolve().then(loop)});$DONE()',
  '$DONE();Promise.resolve().then(()=>{$DONE()})'
];
const watchdog = setTimeout(() => { console.error('REVIEW PROCESS TIMEOUT'); process.exit(2); }, 5000);
for (const source of cases) {
  console.log(source, JSON.stringify(await executeTest262('review.js',
    '/*---\nflags: [async, onlyStrict]\n---*/\n' + source, {
      harness, timeoutMs: 200, budget: { maxSteps: 10000, maxCallDepth: 128 }
    })));
}
clearTimeout(watchdog);
JS
```

Observed, respectively: `passed` with disposal completing (an unresolved Promise alone is not an unhandled rejection); `failed/host-error` with `budgetExceeded/deadline`; `failed/async-failure` for the second successful DONE signal. The 5-second outer watchdog did not fire. No hanging disposal was reproduced by these controls.

## Pinned metadata cross-checks

Independent source scan with `rg -l -F '$262.agent' /private/tmp/safejs-baseline-test262-419d3e0/test/` found 112 JavaScript source files. Cross-checking their manifest flags/features/includes found zero runnable tests missing the current explicit module/blocking/agent/shared-memory guards.

Manifest negative categories (file counts): parse/SyntaxError 4660; resolution/SyntaxError 34; runtime/Test262Error 14; runtime/ReferenceError 14; runtime/SyntaxError 4; runtime/TypeError 4; runtime/EvalError 3; runtime/RangeError 1. Thus an arbitrary parser TypeError cannot satisfy any pinned parse-negative expectation.

These probes and inspections found no additional reproduced runner defect requiring a source change. Full baseline mismatches still require the category owner's focused fixture/control reproduction before being labelled product defects.

## Selection schedule review

The scheduled 108 bounded selections were independently checked before execution: every offset equals the prior selection's end; every expected-variant count equals the sum from the selected manifest files; totals are 53,876 files and 102,926 variants with no overlap or omission. The schedule and manifest both use the original `{}` optional budget configuration (explicitly reported as unlimited optional caps), with a 3,000 ms per-variant deadline.

A further pinned-source scan found 11 files containing a line beginning with `#!`; all have the `raw` flag, so the strict-prefix transformation does not alter those source forms.

# Independent async and host-authority runner audit

Date: 2026-09-12. Source base: `5f6446c4415a9320f53c9db611cd641886447e41` with the frozen ISO-month runtime repair working tree; no runner source changed in this audit. Runtime: Node `22.23.2`, ICU `78.2`, V8 `12.4.254.21-node.56`. This is a bounded independent review, not the full-corpus receipt or a replacement source manifest. No new false-pass defect was validated.

Inspected `execute.ts`, `realm.ts`, `result.ts`, `metadata.ts`, `worker.ts`, rejection tracking and job drain behavior. All nine independently executed in-memory probes matched expected results, exit 0, without changed budgets/timeouts/assertions, test files, index changes or host capabilities. Qualification's existing conservative synchronous rejection-policy disposition remains unchanged.

| Probe | Verified result |
| --- | --- |
| `$DONE()` then 100-link Promise chain issuing failed DONE | failed / async-failure |
| `$DONE()` then 100-link chain throwing undefined | failed / unhandled-rejection, type undefined |
| 100-link chain with handled rejection and successful DONE | passed |
| `$DONE()` then child realm 100-link unhandled rejection | failed / unhandled-rejection |
| Caught child-realm GC request | unsupported / gc |
| Throwing harness plus matching runtime-negative body | failed / harness-error |
| Throwing harness plus parse-negative body | failed / harness-error |
| Runtime SyntaxError where parse negative required | failed / wrong-phase |
| Ambient process, require, setTimeout and agent absent | passed |

Reproduce from the repository root. These are synthetic runner controls; they do not add corpus variants or alter enumeration.

```sh
node --import tsx --input-type=module <<'JS'
import {executeTest262} from './packages/safe-js/test/conformance/execute.ts';
const harness=new Map([['assert.js',''],['sta.js',''],['doneprintHandle.js','function $DONE(error){print(error===undefined?"Test262:AsyncTestComplete":"Test262:AsyncTestFailure:"+error)}']]);
const probes=[
 ['late-done-failure','flags: [async, onlyStrict]','$DONE(); let p=Promise.resolve();for(let i=0;i<100;i++)p=p.then(()=>{});p.then(()=>$DONE("late"))','failed'],
 ['late-rejection','flags: [async, onlyStrict]','$DONE();let p=Promise.resolve();for(let i=0;i<100;i++)p=p.then(()=>{});p.then(()=>{throw undefined})','failed'],
 ['late-handled-rejection','flags: [async, onlyStrict]','let p=Promise.resolve();for(let i=0;i<100;i++)p=p.then(()=>{});p.then(()=>{throw undefined}).catch(()=>$DONE())','passed'],
 ['child-late-rejection','flags: [async, onlyStrict]','$DONE();$262.createRealm().evalScript("let p=Promise.resolve();for(let i=0;i<100;i++)p=p.then(()=>{});p.then(()=>{throw 42})")','failed'],
 ['caught-child-gc','flags: [onlyStrict]','try{$262.createRealm().evalScript("$262.gc()") }catch(e){}','unsupported'],
 ['harness-runtime-negative','flags: [onlyStrict]\nincludes: [bad.js]\nnegative: {phase: runtime, type: TypeError}','throw new TypeError()','failed'],
 ['harness-parse-negative','flags: [onlyStrict]\nincludes: [bad.js]\nnegative: {phase: parse, type: SyntaxError}','let x;let x;','failed'],
 ['wrong-negative-phase','flags: [onlyStrict]\nnegative: {phase: parse, type: SyntaxError}','throw new SyntaxError()','failed'],
 ['host-authority','flags: [onlyStrict]','if(typeof process!=="undefined"||typeof require!=="undefined"||typeof setTimeout!=="undefined"||typeof $262.agent!=="undefined")throw 42;','passed']
];
for(const [id,meta,body,expected] of probes){
 const h=new Map(harness);h.set('bad.js','throw new TypeError("harness")');
 const result=await executeTest262(`${id}.js`,`/*---\n${meta}\n---*/\n${body}`,{harness:h,timeoutMs:2000});
 console.log(JSON.stringify({id,expected,result}));
 if(result.kind!=='test'||result.results.some(r=>r.status!==expected))process.exitCode=1;
}
JS
```

Local commit, remote ancestry and publication: not performed by this audit worker. Delivery retains those separate responsibilities and must not treat this review as release evidence.

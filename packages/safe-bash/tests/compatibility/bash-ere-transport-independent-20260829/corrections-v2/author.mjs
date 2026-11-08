import { strict as assert } from 'node:assert';
import { registerHooks } from 'node:module';
import { readFileSync, lstatSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
const work = fileURLToPath(new URL('.', import.meta.url));
const expectedStat = lstatSync(work + 'PURE-LOADS.json');
if (!expectedStat.isFile() || expectedStat.size > 65536) throw new Error('pure load manifest admission');
const expectedBytes = readFileSync(work + 'PURE-LOADS.json');
if (createHash('sha256').update(expectedBytes).digest('hex') !== process.argv[2]) throw new Error('pure load manifest binding');
const expected = JSON.parse(expectedBytes);
const loaded = [];
const allowedBuiltins = new Set(['node:util', 'node:timers/promises']);
const hooks = registerHooks({ load(url, context, nextLoad) {
  if (url.startsWith('node:')) { if (!allowedBuiltins.has(url)) throw new Error('unsealed pure builtin ' + url); return nextLoad(url, context); }
  const path = fileURLToPath(url);
  const row = expected.find(entry => entry.path === path);
  if (!row) throw new Error('unsealed pure module ' + path);
  const stat = lstatSync(path);
  assert.equal(stat.isFile() && !stat.isSymbolicLink(), true); assert.equal(stat.size, row.bytes);
  const source = readFileSync(path);
  assert.equal(createHash('sha256').update(source).digest('hex'), row.sha256);
  const result = nextLoad(url, context);
  assert.equal(createHash('sha256').update(typeof result.source === 'string' ? Buffer.from(result.source) : Buffer.from(result.source)).digest('hex'), row.sha256);
  loaded.push(row); return result;
}});
const accounting = await import(pathToFileURL(work + 'emitted/transport/accounting.js').href);
const validation = await import(pathToFileURL(work + 'emitted/transport/validation.js').href);
const { EngineAccounting, TransportAccounting, add, multiply, integer, assertBootstrapStorage, metadataUnits } = accounting;
const { inspectInput, copyInput, validateReply, copyReplyResult, record } = validation;
const bounds = { maxExpansionBytes: 4096, maxExpansionFields: 64 };
const fresh = () => { const engine = new EngineAccounting(bounds); return { engine, ledger: new TransportAccounting(engine.limits) }; };
const spent = () => ({ patternBytes: 1, subjectBytes: 1, work: 2, states: 1, allocationUnits: 3, captureBytes: 0, captureSlots: 0 });
const request = limits => ({ version: 1, operation: 'shell-ere', id: 1, grantId: 1, profile: 'ascii-c-posix-v1', bounds, allowance: limits, pattern: [{ text: 'x', literal: false }], subject: 'x' });
const reply = (limits, match = false) => ({ version: 1, operation: 'shell-ere', id: 1, grantId: 1, kind: 'result', result: { matched: match, groupCount: 0, spans: match ? [{ start: 0, end: 0 }] : [null], steps: 2, allocatedUnits: 3 }, usage: { ...spent(), captureSlots: match ? 1 : 0 } });
const cases = [];
function run(id, body) { try { body(); cases.push({ id, pass: true }); } catch (error) { cases.push({ id, pass: false, detail: error instanceof Error ? error.message.slice(0, 2048) : 'non-Error thrown' }); } }
run('P01', () => { const {engine, ledger} = fresh(); let calls = 0; const pattern = [{text:'x',literal:false}]; const proto = Object.create(Array.prototype); Object.defineProperty(proto, 'map', {get(){calls++;throw Error('map trap');}}); Object.defineProperty(proto, Symbol.iterator, {get(){calls++;throw Error('iterator trap');}}); Object.setPrototypeOf(pattern, proto); const input={pattern,subject:'x'}; const inspected=inspectInput(input,engine.limits,ledger); const storage=ledger.reserve(inspected.units*2); storage.consume(inspected.units); const copy=copyInput(inspected,ledger); assert.equal(calls,0); assert.notEqual(copy.pattern,pattern); assert.notEqual(copy.pattern[0],pattern[0]); assert.equal(Object.isFrozen(pattern),false); pattern[0].text='y'; assert.equal(copy.pattern[0].text,'x'); storage.releaseUnused();storage.retire(); });
run('P02', () => { const {engine,ledger}=fresh(); const frame=reply(engine.limits,true); let calls=0; const proto=Object.create(Array.prototype); Object.defineProperty(proto,'map',{get(){calls++;throw Error('map');}}); Object.defineProperty(proto,Symbol.iterator,{get(){calls++;throw Error('iterator');}}); Object.setPrototypeOf(frame.result.spans,proto); const checked=validateReply(frame,request(engine.limits),units=>ledger.visit(units),ledger); const copy=copyReplyResult(checked.reply,ledger); assert.equal(calls,0); frame.result.spans[0].end=1; assert.equal(copy.spans[0].end,0); assert.equal(Object.isFrozen(frame.result.spans),false); });
run('P03', () => { for(const value of [null,false,0,'',undefined]) { const {engine,ledger}=fresh(); assert.throws(()=>inspectInput(value,engine.limits,ledger)); } let gets=0; const array=[]; array.length=1; const {engine,ledger}=fresh(); assert.throws(()=>inspectInput({pattern:array,subject:''},engine.limits,ledger)); const input={pattern:[],subject:''}; Object.defineProperty(input,'extra',{value:1}); assert.throws(()=>inspectInput(input,engine.limits,ledger)); const getter={get pattern(){gets++;return [];},subject:''}; assert.throws(()=>inspectInput(getter,engine.limits,ledger)); assert.equal(gets,0); });
run('P04', () => { let traps=0; const value=new Proxy({pattern:[],subject:''},{ownKeys(){traps++;throw Error('ownKeys');},getOwnPropertyDescriptor(){traps++;throw Error('descriptor');}}); const {engine,ledger}=fresh(); assert.throws(()=>inspectInput(value,engine.limits,ledger)); assert.equal(traps,0); });
run('P05', () => { const {engine,ledger}=fresh(); const controller=new AbortController(); controller.abort(false); const before=ledger.usage; let caught='missing'; try{inspectInput({pattern:[],subject:''},engine.limits,ledger,controller.signal);}catch(reason){caught=reason;} assert.equal(caught,false); assert.deepEqual(ledger.usage,before); });
run('P06', () => { assert.throws(()=>assertBootstrapStorage({maxExpansionBytes:0,maxExpansionFields:0},metadataUnits.root),error=>error.resource==='transportStorage'); assert.doesNotThrow(()=>assertBootstrapStorage(bounds,metadataUnits.root)); const {engine}=fresh(); const ledger=new TransportAccounting({...engine.limits,allocationUnits:9}); assert.throws(()=>ledger.owned(5),error=>error.resource==='transportStorage'); assert.equal(ledger.usage.spent,0); });
run('P07', () => { const {engine}=fresh(); const ledger=new TransportAccounting({...engine.limits,allocationUnits:10}); assert.throws(()=>record({value:1},['value'],units=>ledger.visit(units),ledger),error=>error.resource==='transportStorage'); assert.equal(ledger.usage.spent,0); });
run('P08', () => { const {engine}=fresh(); const first=engine.reserve(3,5); engine.commit(first,spent()); const second=engine.reserve(1,1); assert.equal(second.work,first.work-2); assert.equal(engine.usage.patternBytes,3); assert.equal(engine.usage.subjectBytes,5); assert.throws(()=>engine.commit(second,{...spent(),work:second.work+1})); assert.equal(engine.usage.work,2); engine.commit(second,spent()); assert.equal(engine.usage.work,4); assert.throws(()=>engine.commit(second,spent())); });
run('P09', () => { const {engine}=fresh(); const first=engine.reserve(1,1); engine.abandon(first,false); assert.equal(engine.usage.work,0); const second=engine.reserve(1,1); engine.abandon(second,true); assert.equal(engine.usage.work,engine.limits.work); assert.throws(()=>engine.reserve(1,1)); });
run('P10', () => { const {ledger}=fresh(); const token=ledger.reserve(100); token.consume(20); token.releaseUnused(); assert.equal(ledger.usage.spent,25); assert.equal(ledger.usage.reserved,0); token.retire(); assert.equal(ledger.usage.live,0); assert.equal(ledger.usage.spent,25); const unknown=ledger.reserve(10); unknown.unknown(); unknown.retire(); assert.equal(ledger.usage.spent,40); assert.equal(ledger.usage.reserved,0); assert.equal(ledger.usage.live,0); });
run('P11', () => { for(const value of [-0,-1,NaN,Infinity,1.5])assert.throws(()=>integer(value)); assert.throws(()=>add(Number.MAX_SAFE_INTEGER,1));assert.throws(()=>multiply(Number.MAX_SAFE_INTEGER,2)); const {engine}=fresh(); const ledger=new TransportAccounting({...engine.limits,work:2});ledger.visit(2);assert.throws(()=>ledger.visit(1),error=>error.resource==='transportWork');assert.equal(ledger.usage.work,2); });
run('P12', () => { const {engine,ledger}=fresh(); const frame=reply(engine.limits); const checked=validateReply(frame,request(engine.limits),units=>ledger.visit(units),ledger); assert.deepEqual(copyReplyResult(checked.reply,ledger).spans,[null]);frame.result.spans=[];assert.throws(()=>validateReply(frame,request(engine.limits),()=>{}));frame.result.spans=[null];frame.result.steps=3;assert.throws(()=>validateReply(frame,request(engine.limits),()=>{})); });

const { EreLedger } = await import(pathToFileURL(work + 'emitted/limits.js').href);
const { validateRequest } = validation;
const { workerValidationPrepayment, workerReplyValidationWork } = accounting;
function prepare(limits, entry = 13) {
  const frame=request(limits);let visits=0;
  validateRequest(frame,entry+workerReplyValidationWork,units=>{visits+=units;});
  const ledger=new EreLedger(bounds,limits);ledger.charge('work',entry+workerReplyValidationWork+visits);
  ledger.admitInput('patternBytes',1);ledger.admitInput('subjectBytes',1);
  return {frame,ledger,visits};
}
run('SC13',()=>{const {engine}=fresh();assert.equal(workerReplyValidationWork,210);assert.equal(workerValidationPrepayment(53,1),259);const result=prepare({...engine.limits,work:259});assert.equal(result.visits,36);assert.equal(result.ledger.usage.work,259);assert.throws(()=>result.ledger.charge('work',1),error=>error.resource==='work');let entry=0;record({operation:'shell-ere',version:1},['operation','version'],units=>{entry+=units});record(result.frame,['version','operation','id','grantId','profile','bounds','allowance','pattern','subject'],units=>{entry+=units});assert.equal(entry,13);});
run('SC14',()=>{const {engine}=fresh();assert.throws(()=>prepare({...engine.limits,work:258}),error=>error.resource==='work');let visits=0;assert.throws(()=>validateRequest(request({...engine.limits,work:250}),223,units=>{visits+=units}),error=>error.resource==='work');assert.equal(visits,28);for(const pair of [[46,0],[47,-1],[Number.MAX_SAFE_INTEGER,1],[47,NaN]])assert.throws(()=>workerValidationPrepayment(...pair));});
run('SC15',()=>{const {engine}=fresh();for(const value of [null,undefined,false,0,''])assert.throws(()=>validateRequest(value,223));const frame=request(engine.limits);let calls=0;Object.defineProperty(frame.pattern[0],'text',{get(){calls++;throw Error('getter');}});assert.throws(()=>validateRequest(frame,223));assert.equal(calls,0);const hole=request(engine.limits);delete hole.pattern[0];assert.throws(()=>validateRequest(hole,223));const extra=request(engine.limits);extra[Symbol('extra')]=1;assert.throws(()=>validateRequest(extra,223));let actual='missing';try{validateRequest(request(engine.limits),223,()=>{throw false;});}catch(reason){actual=reason;}assert.equal(actual,false);});
run('SC16',()=>{const {engine}=fresh();const grant=engine.reserve(1,1);const prepared=prepare(grant);const frame=reply(grant);frame.usage={...prepared.ledger.usage};frame.result.steps=frame.usage.work;frame.result.allocatedUnits=frame.usage.allocationUnits;let visits=0;validateReply(frame,prepared.frame,units=>{visits+=units});assert.equal(visits,39);assert.equal(visits+7+frame.result.spans.length,47);assert.equal(frame.usage.work,259);engine.commit(grant,frame.usage);assert.equal(engine.usage.work,259);frame.result.steps=0;assert.throws(()=>validateReply(frame,prepared.frame,()=>{}));});
run('SC17',()=>{const {engine}=fresh();const prepared=prepare(engine.limits);prepared.ledger.charge('work',engine.limits.work-prepared.ledger.usage.work);prepared.ledger.charge('captureSlots',33);const frame={version:1,operation:'shell-ere',id:1,grantId:1,kind:'result',result:{matched:true,groupCount:32,spans:Array.from({length:33},()=>({start:0,end:0})),steps:prepared.ledger.usage.work,allocatedUnits:0},usage:prepared.ledger.usage};let visits=0;validateReply(frame,prepared.frame,units=>{visits+=units});assert.equal(visits,170);assert.equal(visits+7+33,workerReplyValidationWork);assert.equal(frame.usage.work,engine.limits.work);assert.throws(()=>prepared.ledger.charge('work',1));});
run('SC18',()=>{const {engine}=fresh();const prepared=prepare(engine.limits);let maximum=0;for(const category of ['syntax','unsupported','profile-limit'])for(const resource of category==='profile-limit'?['patternBytes','subjectBytes','work','states','allocationUnits','captureBytes','captureSlots']:[null]){const frame={version:1,operation:'shell-ere',id:1,grantId:1,kind:'failure',category,resource,offset:null,usage:prepared.ledger.usage};let visits=0;validateReply(frame,prepared.frame,units=>{visits+=units});assert.equal(visits,34+category.length+(resource?.length??0));maximum=Math.max(maximum,visits+7);assert.ok(visits+7<=workerReplyValidationWork);}assert.equal(maximum,69);const malformed={version:1,operation:'shell-ere',id:1,grantId:1,kind:'failure',category:'profile-limit',resource:false,offset:null,usage:prepared.ledger.usage};assert.throws(()=>validateReply(malformed,prepared.frame,()=>{}));});
run('SC19',()=>{const {engine,ledger:transport}=fresh();const first=engine.reserve(3,5);const one=prepare(first);engine.commit(first,one.ledger.usage);const second=engine.reserve(1,1);const two=prepare(second,10);engine.commit(second,two.ledger.usage);assert.equal(one.ledger.usage.work,259);assert.equal(two.ledger.usage.work,256);assert.equal(engine.usage.work,515);assert.equal(engine.usage.patternBytes,3);assert.equal(engine.usage.subjectBytes,5);assert.equal(transport.usage.work,0);assert.equal(transport.usage.spent,0);assert.equal(second.work,engine.limits.work-259);});
run('SC20',()=>{const {engine}=fresh();const denied=engine.reserve(1,1);engine.abandon(denied,false);assert.equal(engine.usage.work,0);const observed=engine.reserve(1,1);engine.abandon(observed,true);assert.equal(engine.usage.work,engine.limits.work);assert.equal(engine.usage.allocationUnits,engine.limits.allocationUnits);assert.throws(()=>engine.reserve(1,1),error=>error.code==='CLOSED');});

hooks.deregister();
assert.equal(loaded.length,5); assert.equal(new Set(loaded.map(row=>row.path)).size,5);
const result={cases,passed:cases.filter(row=>row.pass).length,total:20,loaded,workerAcquisitions:0,matchingCalls:0};
writeFileSync(work+'PURE-RESULT.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({passed:result.passed,total:20,loads:loaded.length}));if(result.passed!==20)process.exitCode=1;

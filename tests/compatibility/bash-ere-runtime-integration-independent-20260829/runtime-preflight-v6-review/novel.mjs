import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {pathToFileURL} from 'node:url';
import crypto from 'node:crypto';
const [control,cellFile,root]=process.argv.slice(2);
const {terminalOutcome}=await import(pathToFileURL(control+'/guards.mjs'));
const {validateOwner}=await import(pathToFileURL(control+'/owner.mjs'));
const {observeArrays}=await import(pathToFileURL(control+'/array-observer.mjs'));
const rows=[];
async function run(id,body){try{await body();rows.push({id,status:'PASS'});}catch(reason){rows.push({id,status:'FAIL',message:String(reason)});}}
await run('N01-terminal-presence',()=>{for(const reason of [undefined,false,0,null,'']){const outcome=terminalOutcome(true,false,reason);assert.equal(outcome.status,'FAIL');assert.strictEqual(outcome.primary,reason);}});
await run('N02-owner-no-allowance',()=>assert.throws(()=>validateOwner({caseMs:1,retireMs:1,childCapture:1},{deadline:100,maximumStarts:0,starts:0,maximumCapture:1,capture:0,owned:[],secondary:[]},1),/admission/));
await run('N03-unknown-cleanup-not-retired',()=>{assert.equal(terminalOutcome(false,true,undefined).retired,false);assert.equal(terminalOutcome(true,true,0).status,'FAIL');});
class Owner{constructor(){this.calls=0;this.completion=Promise.resolve();this.ledger={snapshot:()=>({used:[0,0,0,0,0,0,0],caps:[1,1,1,1,1,1,1],lastIssued:0})};}reserve(value){this.calls++;return value;}hold(){return this;}close(){this.calls++;return this.completion;}}
class Binding{constructor(owner){this.owner=owner;}retain(){return this;}release(){return this.owner.completion;}}
await run('N04-close-rejected-undefined-forwarded',async()=>{const observed=observeArrays(Owner,Binding),owner=new Owner();owner.completion=Promise.reject(undefined);void owner.completion.catch(()=>{});try{assert.strictEqual(owner.close(),owner.completion);let rejected=false;try{await owner.completion;}catch(reason){rejected=true;assert.strictEqual(reason,undefined);}assert(rejected);await observed.settle();assert(observed.rows.some(row=>row.outcome==='rejected'));}finally{observed.restore();}});
await run('N05-observation-cap-still-forwards',async()=>{const observed=observeArrays(Owner,Binding),owner=new Owner();try{for(let index=0;index<4098;index++)assert.equal(owner.reserve(index),index);assert.equal(owner.calls,4098);assert.equal(observed.rows.length,4096);await assert.rejects(observed.settle(),/record cap/);}finally{observed.restore();}});
const source=fs.readFileSync(cellFile,'utf8');const line=source.split('\n').find(value=>value.startsWith('const emit = row =>'));
assert.equal(line,'const emit = row => fs.writeSync(output, `${JSON.stringify(row)}\n`);');
const observations=[];
function emitter(write){return vm.runInNewContext(line+'\nemit',{fs:{writeSync:write},output:100},{timeout:1000});}
await run('N06-cell-zero-write-must-refuse',()=>{let calls=0;const emit=emitter(()=>{calls++;return 0;});let rejected=false;try{emit({event:'result',status:'PASS'});}catch{rejected=true;}observations.push({id:'N06',calls,rejected});assert(rejected,'cell emitter silently accepts zero-byte publication');});
await run('N07-cell-partial-write-must-complete-or-refuse',()=>{let offered=0,written=0,calls=0;const emit=emitter((descriptor,text)=>{calls++;offered=Buffer.byteLength(text);written++;return 1;});let rejected=false;try{emit({event:'result',status:'PASS'});}catch{rejected=true;}observations.push({id:'N07',calls,offered,written,rejected});assert(rejected||written===offered,'cell emitter silently accepts incomplete publication');});
await run('N08-cell-cap-before-write',()=>{let offered=0;const emit=emitter((descriptor,text)=>{offered+=Buffer.byteLength(text);return Buffer.byteLength(text);});let rejected=false;try{emit({event:'bounded-test',text:'x'.repeat(262145)});}catch{rejected=true;}observations.push({id:'N08',offered,rejected,declaredCellCapture:262144});assert(rejected&&offered===0,'cell event channel has no pre-write cell-capture cap');});
const result={rows,pass:rows.filter(row=>row.status==='PASS').length,fail:rows.filter(row=>row.status==='FAIL').length,observations,source:{path:cellFile,sha256:crypto.createHash('sha256').update(source).digest('hex'),exactHarnessExpression:line},classification:'SYNTHETIC HARNESS ONLY; no actual capture loss or product execution',Workers:0};
fs.writeFileSync(root+'/NOVEL.json',JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(result));process.exitCode=result.fail?1:0;

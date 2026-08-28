import { typedErrorDTO } from './candidate/errors.mjs';
import { createParentRpc } from './candidate/parent-rpc.mjs';
import { Reservations } from './candidate/reservations.mjs';
import { SAB_BYTES, STATES, PHASES, TAGS, views, encode, publish } from './candidate/wire.mjs';
import { observeReason } from './observe.mjs';
const results = [];
function assert(value) { if (value !== true) throw Error('control assertion'); }
function errorRecord() { return { name:'FsError',code:'ENOENT',message:"ENOENT: no such file or directory, readFile '/missing'",errno:-2,path:'/missing',syscall:'readFile',dest:undefined }; }
function rejectSame(value, recognize = item => item === value) {
  let present = false, reason;
  try { typedErrorDTO(value,recognize); } catch (caught) { present=true;reason=caught; }
  assert(present && Object.is(reason,value));
}
async function check(id, operation) {
  try { await operation(); results.push({id,pass:true}); }
  catch { results.push({id,pass:false}); }
}
await check('T01-opaque-stack-accessor',()=>{const value=errorRecord();let calls=0;Object.defineProperty(value,'stack',{get(){calls++;throw false;},set(){calls++;},configurable:true});const dto=typedErrorDTO(value,item=>item===value);assert(dto.name==='FsError'&&dto.code==='ENOENT'&&dto.path==='/missing'&&dto.dest===null&&calls===0&&!Object.hasOwn(dto,'stack'));});
await check('T02-own-undefined-optional',()=>{const value=errorRecord();value.path=undefined;value.syscall=undefined;const dto=typedErrorDTO(value,item=>item===value);assert(dto.path===null&&dto.dest===null&&dto.syscall===null);});
await check('T03-absent-optional',()=>{const value=errorRecord();delete value.path;delete value.dest;delete value.syscall;const dto=typedErrorDTO(value,item=>item===value);assert(dto.path===null&&dto.dest===null&&dto.syscall===null);});
await check('T04-exact-dto-copy',()=>{const value=errorRecord();const dto=typedErrorDTO(value,item=>item===value);assert(Object.keys(dto).join(',')==='name,code,message,errno,path,syscall,dest'&&dto!==value&&dto.message===value.message&&value.dest===undefined);});
await check('T05-required-accessor',()=>{const value=errorRecord();let calls=0;Object.defineProperty(value,'code',{get(){calls++;return 'ENOENT';}});rejectSame(value);assert(calls===0);});
await check('T06-optional-accessor',()=>{const value=errorRecord();let calls=0;Object.defineProperty(value,'path',{get(){calls++;return '/missing';}});rejectSame(value);assert(calls===0);});
await check('T07-extra-data',()=>{const value=errorRecord();value.extra=0;rejectSame(value);});
await check('T08-extra-accessor',()=>{const value=errorRecord();let calls=0;Object.defineProperty(value,'extra',{get(){calls++;throw undefined;}});rejectSame(value);assert(calls===0);});
await check('T09-symbol-extra',()=>{const value=errorRecord();value[Symbol('extra')]=1;rejectSame(value);});
await check('T10-errno-NaN',()=>{const value=errorRecord();value.errno=NaN;rejectSame(value);});
await check('T11-UTF8-field-bound',()=>{const value=errorRecord();value.message='é'.repeat(513);rejectSame(value);});
await check('T12-unrecognized-identity',()=>rejectSame(errorRecord(),()=>false));
await check('T13-undefined-identity',()=>rejectSame(undefined,()=>false));
await check('T14-false-identity',()=>rejectSame(false,()=>false));
await check('T15-observer-proxy',()=>{let calls=0;const value=new Proxy({}, {ownKeys(){calls++;throw false;},getOwnPropertyDescriptor(){calls++;throw false;},getPrototypeOf(){calls++;throw false;},get(){calls++;throw false;}});const record=observeReason(value,()=>{calls++;return true;});assert(record.proxy&&record.guardReason==='proxy-not-inspected'&&calls===0);});
await check('T16-observer-no-getters',()=>{let calls=0;const value=errorRecord();Object.defineProperty(value,'stack',{get(){calls++;throw false;}});Object.defineProperty(value,'code',{get(){calls++;throw false;}});const record=observeReason(value,item=>item===value);assert(calls===0&&record.guardReason==='accessor:code'&&!Object.hasOwn(record.fields,'code')&&record.fields.name.value==='FsError');});
await check('T17-observer-unrecognized-no-values',()=>{const value={message:'synthetic-do-not-publish'};const record=observeReason(value,()=>false);assert(record.guardReason==='origin-unrecognized'&&record.shape.length===0&&Object.keys(record.fields).length===0);});
await check('T18-observer-failure-no-primary-replacement',()=>{const primary={present:true,value:undefined};const record=observeReason(errorRecord(),()=>{throw false;});assert(record.observationFailure===true&&primary.present===true&&Object.is(primary.value,undefined));});
async function route({op='readText', authority='data', closeBefore=false, value=errorRecord(), reconcile=false, malformed=false}) {
  const cleanups=[], failures=[], events=[];
  let opened=true, recognitions=0, closed=0;
  const owner={signal:new AbortController().signal,isOpen:()=>opened,admit:()=>1,event:(kind,seq)=>events.push({kind,seq}),fail:(reason,provenance)=>{failures.push({reason,provenance});opened=false;},registerCleanup:callback=>{let completion;const run=()=>completion??=Promise.resolve().then(callback);cleanups.push(run);return run;}};
  if(malformed) Object.defineProperty(value,'code',{get(){throw Error('accessor must not run');}});
  const sab=new SharedArrayBuffer(SAB_BYTES), parent=views(sab,1,true), sender=views(sab,1);
  const ledger=new Reservations();
  const fixture={namespace:1,authorize:()=>true,start:()=>{if(closeBefore)opened=false;return{result:Promise.reject(value),close:async()=>{closed++;}};}};
  const rpc=createParentRpc(parent,owner,fixture,ledger,item=>{recognitions++;return item===value;});
  const metadata={v:3,session:1,slot:0,seq:1,op,authority,path:op==='readText'?'/missing':null,flag:op==='readText'?'r':null,totalBytes:op==='readText'?null:0,moduleKey:null};
  Atomics.store(sender.header,0,STATES.WORKER);
  const frame=publish(sender,STATES.WORKER,STATES.REQUEST,1,PHASES.HEADER,TAGS.none,0,0,encode(metadata));
  try { await rpc.doorbell({seq:1,frame});if(reconcile){rpc.reconcile();rpc.reconcile();} }
  finally { for(const cleanup of cleanups)await cleanup(); }
  assert(closed===1&&ledger.live===0);
  return{failures,recognitions,outcome:rpc.outcomes.get(1),value,events};
}
await check('R01-FS-typed-route',async()=>{const actual=await route({});assert(actual.outcome.kind==='fsError'&&actual.outcome.original===actual.value&&actual.failures.length===0&&actual.recognitions===1);});
await check('R02-sink-not-FS',async()=>{const actual=await route({op:'writeOutput',authority:'stdout'});assert(!actual.outcome&&actual.recognitions===0&&actual.failures.length===1&&actual.failures[0].reason===actual.value&&actual.failures[0].provenance==='escaping-parent');});
await check('R03-closed-control-false',async()=>{const actual=await route({closeBefore:true,value:false});assert(!actual.outcome&&actual.recognitions===0&&actual.failures.length===1&&Object.is(actual.failures[0].reason,false)&&actual.failures[0].provenance==='late-parent-secondary');});
await check('R04-missing-terminal-reconcile-once',async()=>{const actual=await route({reconcile:true});assert(actual.failures.length===1&&actual.failures[0].reason===actual.value&&actual.failures[0].provenance==='undelivered-parent'&&actual.outcome.reconciled===true);});
await check('R05-malformed-FS-retains-original',async()=>{const actual=await route({malformed:true});assert(!actual.outcome&&actual.failures.length===1&&actual.failures[0].reason===actual.value&&actual.failures[0].provenance==='escaping-parent');});
const result={schema:'l02-repair-data-controls-v1',passed:results.filter(row=>row.pass).length,total:results.length,results,scope:'synthetic native own-data/accessor records and composed parent-rpc with explicitly synthetic owner/provider; no compiled FsError/engine/Worker/guest',counts:{workers:0,guests:0,engineLoads:0,compilerRuns:0,realFsErrorProbes:0}};
await new Promise((resolve,reject)=>process.stdout.write(JSON.stringify(result)+'\n',error=>error?reject(error):resolve()));
if(result.passed!==result.total)process.exitCode=1;

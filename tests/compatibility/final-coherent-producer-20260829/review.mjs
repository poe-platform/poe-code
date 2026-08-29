import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const own = path.dirname(new URL(import.meta.url).pathname), repo = process.cwd();
const hash = raw => crypto.createHash('sha256').update(raw).digest('hex');
const read = filename => { const stat = fs.lstatSync(filename); assert(stat.isFile() && stat.size <= 16777216); const raw = fs.readFileSync(filename); assert.equal(raw.length,stat.size); return raw; };
const sourceCommit = '993e6bf626dc240f11dfc0a7ad348dd641001c0b';
const evidenceCommit = '022f63aee6aa0371679695f6babbe0f4819e6b2e';
const requests = [sourceCommit+':src/shell/runtime.ts','faff3d1b56b841594768e476700209e1d2bca734:src/shell/runtime.ts',evidenceCommit+':tests/shell/local-a-cleanup-v2/prepare-variable-v3/review.mjs',evidenceCommit+':tests/shell/local-a-cleanup-v2/prepare-variable-v3/SOURCE-SEAL.json'];
const stdout = fs.openSync(path.join(own,'review-objects.stdout'),'wx'), stderr = fs.openSync(path.join(own,'review-objects.stderr'),'wx');
const child = spawnSync('/usr/bin/git',['cat-file','--batch'],{input:requests.join('\n')+'\n',stdio:['pipe',stdout,stderr],timeout:20000});
fs.closeSync(stdout); fs.closeSync(stderr); assert.equal(child.status,0);
const data = read(path.join(own,'review-objects.stdout')); let offset=0; const objects=[];
for(const request of requests){const end=data.indexOf(10,offset); const [oid,type,sizeText]=data.subarray(offset,end).toString().split(' '); const size=Number(sizeText); assert.equal(type,'blob'); const raw=data.subarray(end+1,end+1+size); assert.equal(crypto.createHash('sha1').update(Buffer.from(`blob ${size}\0`)).update(raw).digest('hex'),oid); objects.push({request,oid,raw,sha256:hash(raw)}); offset=end+size+2;}
assert.equal(offset,data.length);
const source=objects[0].raw.toString(), base=objects[1].raw.toString(), author=objects[2].raw.toString(), seal=JSON.parse(objects[3].raw);
assert.equal(hash(objects[0].raw),'e55037e0020d3ecefd4f8bdaf80cde1006fee0bbf85bbad26e39a8eac69514c8');
const start=source.indexOf('  async prepareVariable('), end=source.indexOf('  async prepareArrayObservers(',start), oldStart=base.indexOf('  async prepareVariable('), oldEnd=base.indexOf('  async prepareArrayObservers(',oldStart);
assert(start>0 && end>start); assert.equal(source.slice(0,start),base.slice(0,oldStart)); assert.equal(source.slice(end),base.slice(oldEnd));
const method=source.slice(start,end), fragment=method.slice(method.indexOf('\n')+1,method.lastIndexOf('  }')); assert.equal(fragment,seal.fragment);
let executable=fragment; for(const [before,after] of seal.replacements){assert(executable.includes(before)); executable=executable.split(before).join(after);}
const execute=new vm.Script('(async function(env){const {state,name,saved,scalarLegacy,requireArrays,stateMonitor,ArrayOwner,textToken,typedSavedVariables,ArrayFailure}=env;'+executable+'})').runInNewContext({});
const replayCode=author.slice(author.indexOf('  async function probe('),author.indexOf('  const result ='));
const replay=await new vm.Script('(async function(){'+replayCode+'; return {rows,probe};})()').runInNewContext({assert,execute,deadline:Date.now()+60000});
assert.equal(replay.rows.length,8);
const novel=[];
async function check(id,body){try{await body(); novel.push({id,pass:true});}catch(error){novel.push({id,pass:false,error:String(error)});}}
await check('N01-finite-hold-admission-owner-retired',async()=>{
 let budget=64,created=0,closed=0,held=0; const reason={metadataRefusal:true}, saved={}, failures=[];
 const reserve=()=>{if(budget<64)throw reason; budget-=64;};
 const env={state:{},name:'ordinary',saved,scalarLegacy:false,requireArrays:()=>({owner:{ledger:{},hold(){held++; reserve();}}}),stateMonitor:()=>({session:{scope:{failures}}}),ArrayOwner:{create(){reserve();created++;return{async close(){closed++;budget+=64;}};}},textToken:()=>{},typedSavedVariables:new Map(),ArrayFailure:Error};
 let caught=false;try{await execute.call({signal:{}},env);}catch(error){caught=true;assert.equal(error,reason);}assert(caught);assert.equal(created,1);assert.equal(held,1);assert.equal(closed,1);assert.equal(budget,64);assert.equal(failures.length,0);
});
await check('N02-owner-close-raw-null-secondary',async()=>{const row=await replay.probe({stage:'hold',reason:null,cleanup:['close'],secondary:0});assert(row.present);assert.equal(row.actual,null);assert.equal(row.counts.close,1);assert.equal(row.counts.release,0);assert.equal(row.failures.length,1);assert.equal(row.failures[0],0);});
await check('N03-distinct-ordered-cleanup-reasons',async()=>{
 const reasons=[{binding:true},null,false], failures=[], primary=undefined;let calls=[];
 const binding={retain(){return this;},async release(){calls.push('binding');throw reasons[0];}};
 const owner={reserve(){return{};},async close(){calls.push('close');throw reasons[1];}};
 const env={state:{},name:'ordinary',saved:{},scalarLegacy:false,requireArrays:()=>({owner:{ledger:{},hold(){return{release(){calls.push('hold');throw reasons[2];}};}},async watch(){return{valid:()=>true};},get:()=>binding}),stateMonitor:()=>({session:{scope:{failures}}}),ArrayOwner:{create:()=>owner},textToken:async()=>({}),typedSavedVariables:{set(){throw primary;},delete(){}},ArrayFailure:Error};
 let caught=false;try{await execute.call({signal:{}},env);}catch(error){caught=true;assert.equal(error,primary);}assert(caught);assert.deepEqual(calls,['binding','close','hold']);assert.equal(failures.length,3);for(let index=0;index<3;index++)assert.equal(failures[index],reasons[index]);
});
const result={verdict:replay.rows.every(row=>row.pass)&&novel.every(row=>row.pass)?'SOURCE/PURE ACCEPT':'HOLD',sourceCommit,evidenceCommit,runtimeSha256:hash(objects[0].raw),outsideFunctionUnchanged:true,authorReplay:replay.rows,novel,objects:objects.map(({raw,...row})=>({...row,bytes:raw.length})),qualification:'Isolated exact method plus finite doubles only, no Shell/Worker/runtime faults. V2 acceptance and C05 fixture qualification retained; original HOLD evidence immutable.',finished:new Date().toISOString()};
fs.writeFileSync(path.join(own,'SOURCE-REVIEW.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});fs.writeFileSync(path.join(own,'runtime.pinned.ts.data'),objects[0].raw,{flag:'wx'});
console.log(JSON.stringify({result,receiptSha256:hash(read(path.join(own,'SOURCE-REVIEW.json'))),method},null,2));
for(const filename of ['CANDIDATE-INPUTS.json','TYPE-AND-TOOL-BINDINGS.json']){const value=JSON.parse(read('tests/compatibility/final-composition-readiness-20260829/reconciliation-v2/'+filename));console.log(filename,Object.keys(value)); for(const [key,item] of Object.entries(value)){if(Array.isArray(item)) console.log(key,item.length,JSON.stringify(item.slice(0,2)));}}
const composition=JSON.parse(read('tests/compatibility/bash-ere-core-transport-rebind-20260829/COMPOSITION.json')); console.log('COMPOSITION KEYS',Object.keys(composition)); console.log('TOOLS KEYS',Object.keys(composition.tools??{}));
if(result.verdict==='HOLD')process.exitCode=1;

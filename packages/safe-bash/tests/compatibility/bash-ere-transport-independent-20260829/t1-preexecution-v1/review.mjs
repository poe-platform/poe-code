import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';
const here=import.meta.dirname,sha=body=>crypto.createHash('sha256').update(body).digest('hex');
const sealBytes=fs.readFileSync(path.join(here,'PRESEAL.json'));assert.equal(sha(sealBytes),process.argv[2]);const seal=JSON.parse(sealBytes);assert.ok(Date.now()<Date.parse(seal.deadline));
for(const row of seal.files){const stat=fs.lstatSync(path.join(here,row.path));assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size===row.bytes&&stat.size<16000000);assert.equal(sha(fs.readFileSync(path.join(here,row.path))),row.sha256);}
const inputs=JSON.parse(fs.readFileSync(path.join(here,'INPUTS.json')));
function bodyAt(suffix){const rows=inputs.filter(row=>row.path.endsWith(suffix));assert.equal(rows.length,1,suffix);const row=rows[0],body=Buffer.from(row.body,'base64');assert.equal(body.length,row.bytes);assert.equal(sha(body),row.sha256);return body;}
const source=JSON.parse(bodyAt('/SOURCES.json'));assert.equal(source.modules.length,12);for(const row of source.modules){const body=Buffer.from(row.base64,'base64');assert.equal(body.length,row.size);assert.equal(sha(body),row.sha256);assert.equal(crypto.createHash('sha1').update(Buffer.from('blob '+body.length+'\0')).update(body).digest('hex'),row.blob);}
const execution=JSON.parse(bodyAt('/preparation-r2/EXECUTION-PRESEAL.json'));assert.equal(sha(bodyAt('/preparation-r2/EXECUTION-PRESEAL.json')),'97c27022e9f5b80be43c2b74e5e2901a970ac52138ec653336d6e38a62d3430c');
const mapping=JSON.parse(bodyAt('/CASE-MAPPING.json'));
const eligible=mapping.cases.filter(row=>row.method!=='BLOCKED'),deferred=mapping.cases.filter(row=>row.method==='BLOCKED');assert.equal(eligible.length,47);assert.equal(deferred.length,13);
const cells=eligible.flatMap(row=>row.layouts.map(layout=>({id:row.id,layout,Workers:row.workerCeiling})));assert.equal(cells.length,135);assert.equal(cells.reduce((sum,row)=>sum+row.Workers,0),111);
const own=path.join(here,'run'),r2=path.join(own,'preparation-r2');assert.equal(fs.existsSync(own),false);fs.mkdirSync(r2,{recursive:true});fs.mkdirSync(path.join(r2,'capture'));
for(const name of ['PRODUCER.json','PACKAGE.tgz.base64.data','LAYOUTS.json'])fs.writeFileSync(path.join(own,name),bodyAt('/'+name),{flag:'wx'});
for(const name of ['data-support.mjs','owned-process.mjs','receipt-gate.mjs','data-controls-r2.mjs','owner-controls.mjs','OWNER-PRESEAL.json','stub.mjs'])fs.writeFileSync(path.join(r2,name),bodyAt('/preparation-r2/'+name),{flag:'wx'});
await import(pathToFileURL(path.join(r2,'data-controls-r2.mjs')));
const retained=JSON.parse(fs.readFileSync(path.join(r2,'DATA-RESULT.json')));assert.equal(retained.passed,14);assert.equal(retained.total,14);
const controlText=bodyAt('/preparation-r2/control-suite.mjs').toString();const start=controlText.indexOf('async function test('),end=controlText.indexOf('const result={schema:1,old14:');assert.ok(start>0&&end>start);
const finalText=bodyAt('/preparation-r2/finalize-data.mjs').toString();const finalStart=finalText.indexOf('let observed=false;'),finalEnd=finalText.indexOf("const inventoryBytes=",finalStart);assert.ok(finalStart>0&&finalEnd>finalStart);
const prefix="import {strict as assert} from 'node:assert'; import {writeFileSync} from 'node:fs'; import {captureScope,ownChild} from './owned-process.mjs'; import {fullWrite} from './data-support.mjs'; import {judge} from './receipt-gate.mjs'; const results=[];\n";
const middle="\nconst additional=async()=>{\n"+finalText.slice(finalStart,finalEnd)+"\n}; await additional(); writeFileSync(new URL('./PURE-REPLAY.json',import.meta.url),JSON.stringify({groups:results,additional3:true})+String.fromCharCode(10),{flag:'wx'}); if(results.some(row=>!row.pass))throw Error('author control failed');\n";
fs.writeFileSync(path.join(r2,'pure-replay.mjs'),prefix+controlText.slice(start,end)+middle,{flag:'wx'});
await import(pathToFileURL(path.join(r2,'pure-replay.mjs')));
const author=JSON.parse(fs.readFileSync(path.join(r2,'PURE-REPLAY.json')));assert.equal(author.groups.length,16);assert.ok(author.groups.every(row=>row.pass));
const {judge}=await import(pathToFileURL(path.join(r2,'receipt-gate.mjs')));
function receipt(){return{schema:1,id:'P01/matched-vector',layout:'built',pass:true,assertions:true,primary:{present:false},cleanup:{present:false},expectedCleanupFailure:false,testOwnerRetired:true,subjectClean:true,WorkerAttempts:1,WorkerStarts:1,WorkerOnline:1,WorkerRetired:1,stdoutDrained:1,stderrDrained:1,unknownAcquisitions:0,unknownRetirements:0,captureFault:false,WorkerExits:1,requests:1,testRescues:0,loads:['root.js','accounting.js','validation.js'].map(name=>({name:'package/ere/transport/'+name,sha256:'a'.repeat(64)})),nestedLoads:[],trace:[{kind:'attempt'},{kind:'constructed',threadId:1},{kind:'online'},{kind:'post',number:1,id:1},{kind:'exit',code:0},{kind:'stdoutEnd'},{kind:'stderrEnd'},{kind:'retired'}],diagnosticIdentityClaim:false};}
const observed={pid:12345,spawned:true,closed:true,signal:null,primary:{present:false},secondary:[],stdoutClosed:true,stderrClosed:true,code:0};
const config={id:'P01/matched-vector',layout:'built',Workers:1,requestCeiling:1,packageRelative:'package',modules:['root.js','accounting.js','validation.js'].map(name=>({path:'package/ere/transport/'+name,sha256:'a'.repeat(64)}))};
assert.equal(judge(receipt(),observed,config).pass,true);
const independent=[];
function probe(id,change){const row=receipt(),outer=structuredClone(observed),setting=structuredClone(config);change(row,outer,setting);let rejected=false,detail=null;try{judge(row,outer,setting);}catch(reason){rejected=true;detail=reason instanceof Error?reason.message:typeof reason;}independent.push({id,expected:'REJECT',rejected,status:rejected?'PASS':'FAIL',detail});}
probe('I01-reversed-worker-arrival',row=>row.trace.reverse());
probe('I02-retired-before-exit',row=>{const retired=row.trace.pop();row.trace.splice(3,0,retired);});
probe('I03-unbound-A03-child-loads',(row,_outer,setting)=>{row.id=setting.id='A03/workerData-env-execArgv';row.nestedLoads=Array.from({length:9},(_,index)=>({name:'unbound-'+index+'.js',sha256:'0'.repeat(64)}));});
probe('I04-child-loads-outside-A03',row=>{row.nestedLoads=[{name:'unbound.js',sha256:'0'.repeat(64)}];});
probe('I05-no-actual-process-admission',(_row,outer)=>{outer.spawned=false;outer.pid=null;});
probe('I06-request-trace-count-mismatch',row=>{row.trace=row.trace.filter(item=>item.kind!=='post');});
probe('I07-nonfinite-trace-sequence',row=>{const post=row.trace.find(item=>item.kind==='post');post.number=-1;post.id=Infinity;});
probe('I08-rejected-retirement-presence',row=>{row.unknownRetirements=1;});
const final=JSON.parse(bodyAt('/preparation-r2/FINAL-DATA-RESULT.json'));
function decode(suffix,max,expected){const text=bodyAt(suffix);if(expected){assert.equal(text.length,expected.textBytes);assert.equal(sha(text),expected.textSha256);}const compressed=Buffer.from(text.toString('ascii').trim(),'base64');if(expected){assert.equal(compressed.length,expected.compressedBytes);assert.equal(sha(compressed),expected.compressedSha256);}const decoded=gunzipSync(compressed,{maxOutputLength:max,info:true});assert.equal(decoded.engine.bytesWritten,compressed.length);if(expected){assert.equal(decoded.buffer.length,expected.decodedBytes);assert.equal(sha(decoded.buffer),expected.decodedSha256);}return JSON.parse(decoded.buffer);}
const inventory=decode('/preparation-r2/CASE-INVENTORY.json.gz.base64.data',2097152);assert.equal(inventory.cases.length,135);
const archive=decode('/preparation-r2/CASES.json.gz.base64.data',33554432,final.caseArchive);assert.equal(archive.entries.length,4191);
const caseMap=new Map(archive.entries.map(row=>[row.path,row]));assert.equal(caseMap.size,4191);let archiveBytes=0;for(const row of archive.entries){const bytes=Buffer.from(row.base64,'base64');assert.equal(bytes.length,row.size);assert.equal(sha(bytes),row.sha256);archiveBytes+=bytes.length;}
for(const cell of inventory.cases){assert.ok(cells.some(row=>row.id===cell.id&&row.layout===cell.layout));for(const row of cell.files){const actual=caseMap.get(cell.folder+'/'+row.path);assert.ok(actual);assert.equal(actual.size,row.size);assert.equal(actual.sha256,row.sha256);}}
assert.ok(Date.now()<Date.parse(seal.deadline));
fs.writeFileSync(path.join(here,'VARIANT-MAP.json'),JSON.stringify({families:32,identities:60,eligible:eligible.map(row=>({id:row.id,method:row.method,layouts:row.layouts,Workers:row.workerCeiling})),deferred:deferred.map(row=>({id:row.id,reason:row.blocker})),cells},null,2)+'\n',{flag:'wx'});
fs.writeFileSync(path.join(here,'RESULT.json'),JSON.stringify({at:new Date().toISOString(),retained14:retained,author16:author.groups,authorAdditional3:true,independent,archiveEntries:4191,archiveBytes,cells:135,workerCeiling:111,productImports:0,matching:0,realWorkers:0,qualification:'Source-exact author assertion blocks; compiler parsing and materialization dispatch intentionally excluded, not a replay of the whole original compiler/controller.'},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({retained14:14,author16:16,authorAdditional3:3,independentPassed:independent.filter(row=>row.rejected).length,independentFailed:independent.filter(row=>!row.rejected).length,realWorkers:0,productImports:0}));

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { authenticate, digest } from '../../candidate-v1/boundary-app.mjs';
import { put } from '../preparation-v3/staging.mjs';
import { deadline } from '../preparation-v4/deadline.mjs';

const clock=deadline(180000),here=path.dirname(fileURLToPath(import.meta.url)),own=path.resolve(here,'../..');
const [sealHash,metadataLabel,label]=process.argv.slice(2); for(const value of [metadataLabel,label])assert.match(value??'',/^[A-Z0-9-]{1,30}$/u);
const seal=JSON.parse(authenticate(path.join(here,'SEAL.json'),sealHash)),allowed=new Map(seal.roles.map(role=>[path.join(own,role.path),role.sha256]));
function verify(){clock.check('synthetic-integrity');for(const [file,hash]of allowed)authenticate(file,hash);authenticate(seal.node.path,seal.node.sha256);}
verify();assert.equal(process.execPath,seal.node.path);assert.equal(process.version,seal.node.version);
const loads=[];
registerHooks({load(url,context,next){if(url.startsWith('node:'))return next(url,context);const file=fileURLToPath(url);assert.ok(allowed.has(file),'sealed harness module only');authenticate(file,allowed.get(file));const loaded=next(url,context);assert.ok(loaded.source!==null&&loaded.source!==undefined);assert.equal(digest(Buffer.from(loaded.source)),allowed.get(file));loads.push({path:file,sha256:allowed.get(file)});return loaded;}});
const recordsRoot=path.join(here,`METADATA-${metadataLabel}`,'records'),finalBytes=fs.readFileSync(path.join(recordsRoot,'FINAL.json')),final=JSON.parse(finalBytes);
assert.equal(final.sealHash,sealHash);assert.equal(final.complete,true);assert.equal(final.unsafeStop,false);assert.equal(final.eligibleAcceptance,true);assert.equal(final.accounting.active,0);assert.equal(final.accounting.children.length,282);
const records=final.accounting.children.map(owner=>{assert.equal(owner.retired,true);assert.equal(owner.groupAbsent,true);assert.equal(owner.closeObserved,true);const record=JSON.parse(authenticate(owner.receipt.path,owner.receipt.sha256));assert.equal(record.code,0);assert.equal(record.stderr,'');return record;});
assert.equal(records.filter(row=>row.args[0]==='cat-file'&&row.args[1]==='blob').length,269);
assert.ok(records.every(row=>!row.args.some(arg=>arg.includes('30f88590')||arg.includes('37ad3f94'))));
const scopeBytes=authenticate(path.join(own,'s06-successor-v1/SCOPE-BINDING-v2.json'),seal.scopeSha256),scope=JSON.parse(scopeBytes),results=[];
const actual=await import(pathToFileURL(path.join(here,'composition.mjs')).href),reference=await import(pathToFileURL(path.join(here,'reference.mjs')).href);
const firstSource=records.findIndex(row=>row.args[0]==='ls-tree'&&row.args.includes('--full-tree'));
const firstBlob=records.findIndex(row=>row.args[0]==='cat-file'&&row.args[1]==='blob');
const rootIndex=records.findIndex(row=>row.args[0]==='ls-tree'&&row.args.length===3),srcIndex=rootIndex+1;
const split=bytes=>bytes.toString().split('\0').slice(0,-1),join=rows=>Buffer.from(rows.join('\0')+'\0');
const changeLine=(bytes,action)=>{const rows=split(bytes);action(rows);return join(rows);};
const replaceMode=bytes=>changeLine(bytes,rows=>{const index=rows.findIndex(row=>row.startsWith('100644 '));assert.ok(index>=0);rows[index]=rows[index].replace(/^100644/u,'100755');});
const badHash=bytes=>changeLine(bytes,rows=>{rows[0]=rows[0].replace(/ [a-f0-9]{40}\t/u,' '+'0'.repeat(40)+'\t');});
function independentComposition(){
  const metadata=record=>split(Buffer.from(record.stdout)).map(line=>{const [header,filename]=line.split('\t'),[mode,,blob]=header.split(' ');return{path:filename,mode:mode==='040000'?'40000':mode,blob};});
  const roots=metadata(records[rootIndex]),source=metadata(records[srcIndex]);
  const leaves=[...roots.filter(entry=>entry.path!=='src'),...source.filter(entry=>entry.mode!=='40000'||!source.some(other=>other.path.startsWith(entry.path+'/')))];
  assert.equal(reference.computedTree(leaves),actual.binding.baseTree,'independent whole baseline reference');
  const entries=new Map(leaves.map(entry=>[entry.path,entry]));for(const entry of scope.selectedSource)entries.set(entry.path,{path:entry.path,mode:entry.mode,blob:entry.blob});
  const composed=reference.computedTree([...entries.values()]);assert.equal(composed,scope.selectedComposition,'independent whole composition reference');return{baseline:actual.binding.baseTree,composed};
}
function changedScope(action){const value=JSON.parse(scopeBytes);action(value);return Buffer.from(JSON.stringify(value,null,2)+'\n');}
async function run(admit,options={}){let cursor=0,effects=0,caught=false,reason,result;const sentinel=options.reason;
  try{result=await admit(options.scope??scopeBytes,async args=>{clock.check('synthetic-replay');const record=records[cursor++];assert.ok(record);assert.deepEqual(args,record.args,'exact finite metadata read role');if(cursor-1===options.throwAt)throw sentinel;const bytes=Buffer.from(record.stdout);return cursor-1===options.at?options.change(bytes):bytes;},()=>{clock.check('synthetic-checkpoint');if(options.checkpointThrow)throw sentinel;});effects++;}
  catch(error){caught=true;reason=error;}
  return{cursor,effects,caught,reason,result};
}
const checks=[
 ['C01',{}],
 ['C02',{scope:changedScope(value=>{value.status+=' changed';}),early:true}],
 ['C03',{at:firstSource,change:replaceMode}],
 ['C04',{at:firstSource,change:bytes=>changeLine(bytes,rows=>{rows[0]=rows[0].replace(/\t[^\0]+$/u,'\tWRONG-PATH');})}],
 ['C05',{at:firstSource,change:bytes=>changeLine(bytes,rows=>{[rows[0],rows[1]]=[rows[1],rows[0]];})}],
 ['C06',{at:firstSource,change:bytes=>changeLine(bytes,rows=>{rows.push('100644 blob '+'1'.repeat(40)+'\tzz-extra');})}],
 ['C07',{at:firstSource,change:bytes=>changeLine(bytes,rows=>rows.pop())}],
 ['C08',{at:firstSource,change:bytes=>changeLine(bytes,rows=>rows.push(rows[0]))}],
 ['C09',{at:firstSource,change:badHash}],
 ['C10',{at:0,change:()=>Buffer.from('object '+'1'.repeat(40)+'\ntype commit\ntag not-a-commit\n\n')}],
 ['C11',{throwAt:5,reason:Object.freeze({unknownBase:true}),identity:true}],
 ['C12',{at:rootIndex,change:replaceMode}],
 ['C13',{at:rootIndex,change:bytes=>changeLine(bytes,rows=>{rows[0]=rows[0].replace(/\t[^\0]+$/u,'\tWRONG-ROOT-PATH');})}],
 ['C14',{at:rootIndex,change:bytes=>changeLine(bytes,rows=>rows.reverse())}],
 ['C15',{at:rootIndex,change:bytes=>changeLine(bytes,rows=>rows.push('100644 blob '+'1'.repeat(40)+'\tzz-extra'))}],
 ['C16',{at:rootIndex,change:bytes=>changeLine(bytes,rows=>rows.pop())}],
 ['C17',{at:rootIndex,change:bytes=>bytes.subarray(0,-1)}],
 ['C18',{at:srcIndex,change:badHash}],
 ['C19',{at:srcIndex,change:bytes=>changeLine(bytes,rows=>{const index=rows.findIndex(row=>row.startsWith('100644 '));assert.ok(index>=0);rows.splice(index,1);})}],
 ['C20',{throwAt:firstBlob,reason:false,identity:true}],
 ['C21',{at:firstBlob,change:bytes=>{const changed=Buffer.from(bytes);changed[0]^=1;return changed;}}],
 ['C22',{at:firstBlob,change:bytes=>Buffer.concat([bytes,Buffer.from('x')])}],
 ['C23',{at:firstSource,change:bytes=>changeLine(bytes,rows=>{rows[0]=rows[0].replace(/^100644 blob/u,'040000 tree');})}],
 ['C24',{at:firstBlob,change:()=>Buffer.from([255,254,0])}],
 ['C25',{scope:changedScope(value=>{value.expectedManifestSha256='0'.repeat(64);}),early:true}],
 ['C26',{scope:changedScope(value=>{[value.selectedSource[0],value.selectedSource[1]]=[value.selectedSource[1],value.selectedSource[0]];}),early:true}],
 ['C27',{scope:changedScope(value=>{value.selectedSource[0].path='AGENTS.md';}),early:true}],
 ['C28',{checkpointThrow:true,reason:0,identity:true,early:true}]
];
async function check(id,body){clock.check('synthetic-case');try{const detail=await body();results.push({id,pass:true,detail});}catch(reason){results.push({id,pass:false,error:String(reason?.stack??reason)});}verify();}
for(const [id,options]of checks)await check(id,async()=>{const value=await run(actual.admitSelectedSource,options);if(id==='C01'){assert.equal(value.caught,false,String(value.reason));assert.equal(value.cursor,282);assert.equal(value.effects,1);assert.equal(value.result.files.size,269);assert.equal(value.result.evidence.derivedComposition,scope.selectedComposition);return{...value.result.evidence,independentReference:independentComposition()};}assert.equal(value.caught,true,'admission must reject altered input');assert.equal(value.effects,0);if(options.identity)assert.equal(value.reason,options.reason);if(options.early)assert.equal(value.cursor,0);return{reads:value.cursor,effects:value.effects,reason:String(value.reason)};});
const vectors=JSON.parse(authenticate(path.join(here,'TREE-VECTORS.json'),allowed.get(path.join(here,'TREE-VECTORS.json'))));
for(const vector of vectors)await check(vector.id,()=>{if(vector.invalid){for(const entries of vector.inputs)assert.throws(()=>actual.treeHash(entries));return{refused:vector.inputs.length};}const expected=reference.computedTree(vector.entries.map(entry=>({path:entry.name,mode:entry.mode,blob:entry.hash})));assert.equal(expected,vector.expected);assert.equal(actual.treeHash(vector.entries),expected);return{hash:expected};});
assert.equal(results.length,36);
const mutants=[];
for(const mutation of seal.admissionMutants){verify();const file=path.join(here,mutation.file),module=await import(pathToFileURL(file).href);assert.ok(loads.some(row=>row.path===file&&row.sha256===mutation.sha256));const options=checks.find(([id])=>id===mutation.case)[1];const value=await run(module.admitSelectedSource,options);let killed=false;if(mutation.case==='C01')killed=value.caught&&value.effects===0;else killed=!value.caught&&value.effects===1;mutants.push({id:mutation.id,case:mutation.case,loadedPath:file,loadedSha256:mutation.sha256,killed,reads:value.cursor,effects:value.effects,reason:value.caught?String(value.reason):null});}
const after=await run(actual.admitSelectedSource);assert.equal(after.caught,false,String(after.reason));assert.equal(after.result.files.size,269);verify();
const result={kind:'whole-composition-admission-DATA-synthetic-not-product',sealHash,metadataFinalSha256:digest(finalBytes),results,mutants,positiveAfter:true,loads,actualChildProcesses:0,actualCandidateImports:0,actualNativeOracleCalls:0,elapsedBeforePublicationMs:clock.elapsed()};
const output=path.join(here,`SYNTHETIC-${label}.json`);put(output,JSON.stringify(result)+'\n');clock.check('synthetic-final-publication');
const accepted=results.every(row=>row.pass)&&mutants.length===3&&mutants.every(row=>row.killed);console.log(JSON.stringify({accepted,cases:results.length,passed:results.filter(row=>row.pass).length,loadedMutants:mutants.length,killed:mutants.filter(row=>row.killed).length,positiveAfter:true,captureSha256:digest(fs.readFileSync(output)),failures:results.filter(row=>!row.pass)}));clock.check('synthetic-exit');process.exitCode=accepted?0:1;

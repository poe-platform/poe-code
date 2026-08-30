import { readFile, writeFile, lstat, readdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const own = dirname(fileURLToPath(import.meta.url));
const outer = join(own,'SYNTHESIS.outer.jsonl');
await writeFile(outer,JSON.stringify({event:'start',date:new Date().toISOString(),pid:process.pid,productExecution:false})+'\n',{flag:'wx'});
async function hash(path) {
  const stat=await lstat(path); assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=128*1024*1024);
  const digest=createHash('sha256'); for await(const bytes of createReadStream(path,{highWaterMark:65536})) digest.update(bytes);
  return {path,size:stat.size,mode:stat.mode&0o777,sha256:digest.digest('hex')};
}
async function json(path) { const record=await hash(path); assert.ok(record.size<1048576); return JSON.parse(await readFile(path,'utf8')); }
try {
  const seal=await json(join(own,'SEAL.json')); const result=await json(join(own,'ACTUAL-01/RESULT.json'));
  for(const record of [seal.node,...seal.sources,...seal.originals,...seal.fixtures,...seal.reversionInputs,...seal.harness,...seal.tools,...result.finalCensus]) assert.deepEqual(await hash(record.path),record);
  const old=await json(join(dirname(own),'ACTUAL-03/RESULT.json'));
  const declarations=[];
  for(const current of result.emittedBindings.filter(entry=>entry.path.endsWith('.d.ts'))) {
    const baseline=old.emittedBinding.find(entry=>basename(entry.path)===basename(current.path)); assert.ok(baseline);
    assert.deepEqual(await hash(baseline.path),baseline); assert.equal(current.sha256,baseline.sha256); declarations.push({name:basename(current.path),sha256:current.sha256,unchanged:true});
  }
  const captures=[];
  for(const name of (await readdir(join(own,'ACTUAL-01'))).sort()) if(name.endsWith('.stdout')||name.endsWith('.stderr')||name==='outer.jsonl'||name==='RESULT.json') captures.push(await hash(join(own,'ACTUAL-01',name)));
  const rows=result.rows.map(row=>({role:row.role,mutated:row.mutated,exitCode:row.exitCode,pass:row.observed.pass,fail:row.observed.fail,details:row.observed.rows.filter(entry=>entry.id.startsWith('C'))}));
  const summary={date:new Date().toISOString(),sourceBindings:seal.sources,sealSha256:(await hash(join(own,'SEAL.json'))).sha256,node:seal.node,rows,types:result.types,mutants:result.mutants,guards:result.guards,declarations,captures,children:result.children,peakChildren:result.peakChildren,active:result.active,captureBytes:result.captureBytes,workBytes:result.workBytes,elapsedMs:result.elapsedMs,R01:'HELD; seven independent failures and native ambiguity unchanged; no rerun',native:'UNRUN',workers:0};
  await writeFile(join(own,'SUMMARY.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
  await writeFile(outer,JSON.stringify({event:'complete',sha256:(await hash(join(own,'SUMMARY.json'))).sha256})+'\n',{flag:'a'});
  console.log(JSON.stringify({sources:seal.sources,seal:summary.sealSha256,rows:rows.map(row=>({role:row.role,pass:row.pass,fail:row.fail})),sourceControls:rows.find(row=>row.role==='source-checkpoints8').details,types:result.types,mutants:result.mutants,guards:result.guards.map(entry=>({id:entry.id,refused:entry.refused})),declarations,children:result.children,active:result.active,captureBytes:result.captureBytes,workBytes:result.workBytes,elapsedMs:result.elapsedMs},null,2));
} catch(error) {await writeFile(outer,JSON.stringify({event:'failure',error:String(error?.stack??error)})+'\n',{flag:'a'});process.exitCode=1;}

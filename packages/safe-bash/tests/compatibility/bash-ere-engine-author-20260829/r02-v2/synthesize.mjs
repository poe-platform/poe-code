import {open,lstat,readFile,writeFile,readdir} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,join,basename,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const own=dirname(fileURLToPath(import.meta.url)),author=dirname(own),repo=resolve(own,'../../../..');
const outer=await open(join(own,'SYNTHESIS.outer.jsonl'),'wx');
await outer.write(JSON.stringify({start:new Date().toISOString(),pid:process.pid,productExecution:false})+'\n');
async function hash(path){const stat=await lstat(path);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=128*1024*1024);const digest=createHash('sha256');for await(const bytes of createReadStream(path,{highWaterMark:65536}))digest.update(bytes);return {path,size:stat.size,mode:stat.mode&511,sha256:digest.digest('hex')};}
async function text(path){const entry=await hash(path);assert.ok(entry.size<=1048576);return readFile(path,'utf8');}
try{
  const seal=JSON.parse(await text(join(own,'SEAL.json'))),result=JSON.parse(await text(join(own,'ACTUAL-01/RESULT.json')));
  for(const entry of [seal.node,...seal.sources,...seal.originals,...seal.fixtures,...seal.reversionInputs,...seal.harness,...seal.tools,...result.finalCensus])assert.deepEqual(await hash(entry.path),entry);
  const old=JSON.parse(await text(join(author,'r02-v1/ACTUAL-01/RESULT.json'))),declarations=[];
  for(const entry of result.emittedBindings.filter(row=>row.path.endsWith('.d.ts'))){const previous=old.emittedBindings.find(row=>basename(row.path)===basename(entry.path));assert.ok(previous);assert.deepEqual(await hash(previous.path),previous);assert.equal(entry.sha256,previous.sha256);declarations.push({name:basename(entry.path),sha256:entry.sha256,unchanged:true});}
  const originalN01=await text(join(repo,'tests/compatibility/bash-ere-checkpoint-independent-20260829/novel.mjs'));
  const currentN01=await text(join(own,'empty.mjs'));
  const start="await check('N01-empty-fragment-first-pass'";
  const body=originalN01.slice(originalN01.indexOf(start),originalN01.indexOf("await check('N02-bulk-work-checkpoint'"));
  assert.equal(currentN01.slice(currentN01.indexOf(start),currentN01.indexOf("await check('E02-empty-boundaries'")),body);
  const oldSyntax=await text(seal.originals.find(entry=>basename(entry.path)==='syntax.ts').path),newSyntax=await text(seal.sources.find(entry=>basename(entry.path)==='syntax.ts').path);
  const before='    ledger.charge("work", 1, signal);\n    ledger.admitInput("patternBytes", fragment.text.length, signal);';
  assert.equal(oldSyntax.split(before).length,2);
  assert.equal(newSyntax,oldSyntax.replace(before,'    ledger.charge("work", 1, signal);\n    await ledger.checkpoint(signal);\n    ledger.admitInput("patternBytes", fragment.text.length, signal);'));
  for(const entry of seal.sources.filter(row=>basename(row.path)!=='syntax.ts'))assert.equal(entry.sha256,seal.originals.find(row=>basename(row.path)===basename(entry.path)).sha256);
  const captures=[];for(const name of (await readdir(join(own,'ACTUAL-01'))).sort())if(name.endsWith('.stdout')||name.endsWith('.stderr')||name==='outer.jsonl'||name==='RESULT.json')captures.push(await hash(join(own,'ACTUAL-01',name)));
  const summary={sourceBindings:seal.sources,sealSha256:(await hash(join(own,'SEAL.json'))).sha256,exactOneLineSourceDelta:true,N01bodySha256:createHash('sha256').update(body).digest('hex'),N01bodyUnchanged:true,declarations,rows:result.rows.map(row=>({role:row.role,mutated:row.mutated,pass:row.observed.pass,fail:row.observed.fail,details:row.role.includes('empty')?row.observed.rows:undefined})),types:result.types,mutants:result.mutants,guards:result.guards,captures,children:result.children,active:result.active,peakChildren:result.peakChildren,captureBytes:result.captureBytes,workBytes:result.workBytes,elapsedMs:result.elapsedMs};
  await writeFile(join(own,'SUMMARY.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});await outer.write(JSON.stringify({complete:new Date().toISOString(),summarySha256:(await hash(join(own,'SUMMARY.json'))).sha256})+'\n');
  console.log(JSON.stringify({...summary,captures:undefined,rows:summary.rows.map(row=>({...row,details:row.role==='source-empty4'||row.mutated?row.details:undefined}))},null,2));
}catch(error){await outer.write(JSON.stringify({failure:String(error?.stack??error)})+'\n');process.exitCode=1;}finally{await outer.close();}

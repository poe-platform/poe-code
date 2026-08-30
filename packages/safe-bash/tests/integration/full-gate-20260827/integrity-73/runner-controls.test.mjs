import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { createTreeGuard } from './tree.mjs';

const runner = readFileSync(new URL('../combined-8670ebe8/run.mjs', import.meta.url), 'utf8');
function boundary(source, duringChild) {
  const observations=[], report={phases:[]};let children=0;
  const declarations=runner.slice(runner.indexOf('const sourceHashes = {};'),runner.indexOf('function copyDependencies('));
  const phase=runner.slice(runner.indexOf('async function phase('),runner.indexOf('\ntry {',runner.indexOf('async function phase(')));
  assert.ok(declarations.includes('createTreeGuard'));assert.ok(phase.includes('verifySource'));
  const bindings={assert,createTreeGuard,source,temporary:dirname(source),output:dirname(source),report,
    hash:bytes=>createHash('sha256').update(bytes).digest('hex'),lstatSync,readFileSync,readlinkSync,realpathSync,join,pathToFileURL,
    environment:{},npmPath:'unused',runtimeReceipt:{identity:{path:process.execPath}},save:(name,value)=>observations.push({name,value}),
    supervise:async()=>{children++;await duringChild?.();return{observed:[],status:0,clean:true};},account:()=>{throw Error('not canonical execution');}};
  const api=new Function('bindings',`const {${Object.keys(bindings).join(',')}}=bindings;${declarations}\n${phase}\nreturn{sealTree,verifySource,phase};`)(bindings);
  return { ...api, observations, children:()=>children };
}
for(const timing of ['before','during'])for(const kind of ['source','installed-consumer'])test(`actual runner phase rejects ${kind} addition ${timing} child`,async context=>{
  const parent=realpathSync(mkdtempSync(join(tmpdir(),'integrity73-phase-'))),root=join(parent,'tree');mkdirSync(root);writeFileSync(join(root,'file'),'baseline');
  context.after(()=>rmSync(parent,{recursive:true,force:true}));
  const mutate=()=>writeFileSync(join(root,'late'),'unapproved');const api=boundary(root,timing==='during'?mutate:undefined);api.sealTree(kind,root);
  if(timing==='before')mutate();await assert.rejects(api.phase('probe',process.execPath,[]),/Protected inputs|Frozen tracked inputs/);
  assert.equal(api.children(),timing==='before'?0:1);assert.ok(api.observations.some(row=>row.value.changes?.some(change=>change.kind==='added')));
});
test('actual runner never reseals an existing named tree',context=>{
  const root=realpathSync(mkdtempSync(join(tmpdir(),'integrity73-reseal-')));context.after(()=>rmSync(root,{recursive:true,force:true}));
  const api=boundary(root);api.sealTree('source',root);writeFileSync(join(root,'late'),'addition');assert.throws(()=>api.sealTree('source',root),/Never silently rebaseline/);assert.ok(api.verifySource().length);
});
test('runner staging and setup boundary policies are explicit',()=>{
  assert.ok(!runner.includes('command -v rg'));
  assert.ok(runner.includes('native.push(["rg", rgPath])'));
  assert.ok(runner.indexOf("sealTree(`input-${name}`")<runner.indexOf('phase("typecheck-all"'));
  assert.ok(runner.indexOf("sealTree('source-after-build'")>runner.indexOf('typeReport.builds'));
  assert.ok(runner.indexOf("sealTree('installed-consumer'")>runner.indexOf('copyFileSync(join(harness, "public.mjs")'));
  assert.ok(!runner.includes("protectedTrees.clear()"));
});
test('actual consumer capture allocation is unique canonical OS temp outside source',context=>{
  const original=readFileSync(new URL('../../../plugins/qualified-current-release/snapshot.mjs',import.meta.url),'utf8');
  const declaration=original.match(/^  const directory = .*;$/m)?.[0];assert.ok(declaration);
  const base=realpathSync(mkdtempSync(join(tmpdir(),'integrity73-capture-'))),source=join(base,'source');mkdirSync(source);
  context.after(()=>rmSync(base,{recursive:true,force:true}));const before=createTreeGuard(source);
  const allocate=new Function('realpathSync','mkdtempSync','join','tmpdir',`${declaration};return directory;`);
  const first=allocate(realpathSync,mkdtempSync,join,()=>base),second=allocate(realpathSync,mkdtempSync,join,()=>base);
  assert.notEqual(first,second);assert.ok(existsSync(first)&&existsSync(second));assert.deepEqual(before.check().changes,[]);
});

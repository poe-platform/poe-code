import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {discoverWorkflowDocs,resolveWorkflowPath} from '../dist/index.js';
import {native} from '../dist/native.js';
test('workflow path normalization preserves SDK forms and absolute spelling',()=>{
 for(const input of ['~','~/../plans.md','./docs/../plan.md','/repo/../plan.md','~other','']) {
  const expected=input==='~'?'/home':input.startsWith('~/')?path.join('/home',input.slice(2)):path.isAbsolute(input)?input:path.resolve('/repo',input);
  assert.equal(resolveWorkflowPath(input,'/repo','/home'),expected);
 }
});
test('glob matching retains UTF-16 literals and ECMAScript Unicode casing',()=>{
 for(const name of ['PLAN.MD','plan.md','İ.MD','Σ.MD','ß.md','𐐀.MD','\ud800.MD','__proto__','constructor',''])
  for(const glob of ['*','*.md','*.MD','*.','*.İ.MD','__proto__','PLAN.MD','']) {
   const expected=glob==='*'||(glob.startsWith('*.')?name.toLowerCase().endsWith(glob.slice(1).toLowerCase()):name===glob);
   assert.equal(native.harnessMatchesGlob(name,name.toLowerCase(),glob,glob.toLowerCase()),expected,JSON.stringify([name,glob]));
  }
 assert.equal(native.harnessMatchesGlob('x.md','x.md','*.md',''),false);
});
test('discovery preserves filesystem failure identity and literal prototype names',async()=>{
 const error={code:'EACCES'},seen=[];
 const fs={async lstat(target){seen.push(target);return {isSymbolicLink:()=>false};},async readdir(target){if(target.startsWith('/repo'))return ['__proto__','constructor'];return ['__proto__','other'];}};
 assert.deepEqual(await discoverWorkflowDocs({cwd:'/repo',homeDir:'/home',subDirectory:'plans',glob:'*',fs}),['/home/.poe-code/plans/other','/repo/.poe-code/plans/__proto__','/repo/.poe-code/plans/constructor']);
 await assert.rejects(discoverWorkflowDocs({cwd:'/repo',homeDir:'/home',subDirectory:'plans',fs:{...fs,async readdir(){throw error;}}}),e=>e===error);
 seen.length=0;
 await assert.rejects(discoverWorkflowDocs({cwd:'/repo',homeDir:'/home',subDirectory:'../../outside',fs}),/remain within/);
 assert.equal(seen.length,0);
});

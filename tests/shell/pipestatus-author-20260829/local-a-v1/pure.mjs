import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const own='/Users/kjopek/Workspace/safe-bash/tests/shell/pipestatus-author-20260829/local-a-v1';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const seal=JSON.parse(fs.readFileSync(own+'/SEAL.json','utf8'));
for(const row of [seal.source,seal.base,...seal.files]){const stat=fs.lstatSync(row.path);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size===row.bytes);assert.equal(hash(fs.readFileSync(row.path)),row.sha256);}
const source=fs.readFileSync(seal.source.path,'utf8'),base=fs.readFileSync(seal.base.path,'utf8');
const start=source.indexOf('function localDeclarationOptions('),end=source.indexOf('\nfunction decimalIndex(',start);
assert(start>=0&&end>start);
const exact=source.slice(start,end);
const moduleText='export '+exact.replace('args: readonly string[], signal: AbortSignal): { readonly indexed: boolean; readonly offset: number; readonly error: string | undefined }','args, signal)').replace('args[offset++]!','args[offset++]');
const {localDeclarationOptions:parse}=await import('data:text/javascript;base64,'+Buffer.from(moduleText).toString('base64'));
const rows=[];async function test(id,body,kind='PURE_EXTRACTED_PARSER'){try{await body();rows.push({id,kind,pass:true});}catch(error){rows.push({id,kind,pass:false,error:String(error)});}}
const vectors=[ [[],false,0,undefined],[['name'],false,0,undefined],[['-a','name'],true,1,undefined],[['-a','-a','name'],true,2,undefined],[['--','name'],false,1,undefined],[['-a','--','name'],true,2,undefined],[['-A','name'],false,1,'-A'],[['-r','name'],false,1,'-r'],[['-aa','name'],false,1,'-aa'],[['-a'],true,1,undefined],[['name','-a'],false,0,undefined],[['--','-a'],false,1,undefined],[['-a','name=x=y'],true,1,undefined],[[''],false,0,undefined] ];
for(let index=0;index<vectors.length;index++){const [args,indexed,offset,error]=vectors[index];await test('P'+String(index+1).padStart(2,'0'),()=>assert.deepEqual(parse(args,new AbortController().signal),{indexed,offset,error}));}
for(const [index,reason] of [false,0,null].entries())await test('P'+(index+15),()=>{const controller=new AbortController();controller.abort(reason);let caught=false;try{parse(['-a','name'],controller.signal);}catch(error){caught=true;assert.equal(error,reason);}assert(caught);});
const branchStart=source.indexOf('        if (command === "local" && indexedLocal) {'),branchEnd=source.indexOf('        if (command === "local" && !locals!.has(name)) {',branchStart),branch=source.slice(branchStart,branchEnd);
await test('P18',()=>{assert(branch.indexOf('if (state.readonlyVariables?.has(name))')<branch.indexOf('if (!watch.valid())'));assert(branch.indexOf('await store.prepareName')<branch.indexOf('store.publish'));assert(branch.includes('delete state.variables[name]'));assert(!branch.includes('name === "PIPESTATUS"'));},'SOURCE_ONLY');
await test('P19',()=>{const marker='        if (command === "local" && !locals!.has(name)) {';assert.equal(source.slice(source.indexOf(marker)),base.slice(base.indexOf(marker)));},'SOURCE_ONLY_PLAIN_AND_FOREIGN_SUFFIX');
await test('P20',()=>{assert.equal(source.slice(0,start),base.slice(0,base.indexOf('function decimalIndex(')));const middleStart=source.indexOf('function decimalIndex('),middleEnd=source.indexOf('      let indexedLocal = false;');assert.equal(source.slice(middleStart,middleEnd),base.slice(base.indexOf('function decimalIndex('),base.indexOf('      if (command === "readonly") {',base.indexOf('    if (command === "export" || command === "local"'))));},'SOURCE_ONLY_FOREIGN_PREFIX');
fs.writeFileSync(own+'/PURE-RESULT.json',JSON.stringify({rows,passed:rows.filter(row=>row.pass).length,total:rows.length,parserFragmentSha256:hash(Buffer.from(exact)),testModuleSha256:hash(Buffer.from(moduleText)),qualification:'17 extracted-parser controls plus3 SOURCE checks, not full Runtime/binding execution',ShellExecutions:0,compilerCalls:0},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({passed:rows.filter(row=>row.pass).length,total:rows.length,failures:rows.filter(row=>!row.pass)}));if(rows.some(row=>!row.pass))process.exitCode=1;

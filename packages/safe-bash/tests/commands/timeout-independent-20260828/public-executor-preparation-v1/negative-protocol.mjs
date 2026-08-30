import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { recipe, repository, owned, write, save, safe, inventory, sameInventory, fileHash, reason } from './common.mjs';

export const negativeRows = [
  {id:'N01',kind:'root-export',code:'ERR_ASSERTION',message:'MISSING_ROOT_EXPORT:createTimeoutCommand'},
  {id:'N02',kind:'missing-subpath',code:'ERR_PACKAGE_PATH_NOT_EXPORTED',message:"Package subpath './commands/timeout' is not defined by"},
  {id:'N03',kind:'wrong-leaf',code:'ERR_ASSERTION',message:'LEAF_EXPORTS'},
  {id:'N04',kind:'missing-runtime',code:'ERR_MODULE_NOT_FOUND',message:'/dist/commands/timeout/index.js'},
  {id:'N05',kind:'missing-declaration',compilerCode:7016,meaning:"Could not find a declaration file for module 'virtual-bash/commands/timeout'"},
  {id:'N06',kind:'tampered-load',code:'ERR_ASSERTION',message:'MODULE_HASH_MISMATCH'},
  {id:'N07',kind:'source-fallback',code:'ERR_ASSERTION',message:`UNBOUND_MODULE:${resolve(repository,'src/index.ts')}`,target:pathToFileURL(resolve(repository,'src/index.ts')).href},
];

export function freshControls(root) {
  const results=[];fs.mkdirSync(root);const target=resolve(root,'input.data');write(target,'frozen\n');const initial=inventory(root);
  const run=(id,action,restore,needle)=>{let caught;try{action();}catch(error){caught=reason(error);}finally{restore();}assert.ok(caught?.message.includes(needle),id);sameInventory(inventory(root),initial);results.push({id,rejected:true,caught,restored:true});};
  run('G01-new-entry',()=>{write(resolve(root,'extra.data'),'extra');sameInventory(inventory(root),initial);},()=>fs.unlinkSync(resolve(root,'extra.data')),'COMPLETE_FRESH_INVENTORY');
  run('G02-mode',()=>{fs.chmodSync(target,0o755);sameInventory(inventory(root),initial);},()=>fs.chmodSync(target,initial[0].mode),'COMPLETE_FRESH_INVENTORY');
  run('G03-hash',()=>{fs.writeFileSync(target,'changed');sameInventory(inventory(root),initial);},()=>fs.writeFileSync(target,'frozen\n'),'COMPLETE_FRESH_INVENTORY');
  run('G04-AGENTS-name-only',()=>safe('AGENTS.md'),()=>{},'AGENTS_NAME');
  run('G05-symlink',()=>{fs.symlinkSync('input.data',resolve(root,'alias'));inventory(root);},()=>fs.unlinkSync(resolve(root,'alias')),'SYMLINK');
  run('G06-missing-input',()=>{fs.renameSync(target,resolve(root,'renamed.data'));sameInventory(inventory(root),initial);},()=>fs.renameSync(resolve(root,'renamed.data'),target),'COMPLETE_FRESH_INVENTORY');
  return results;
}

export async function packageNegatives({ work, raw, packageRoot, packageFiles, candidate, child, tool, compiler, compilerTypeRoots, toolMap, helperLoads, guarded }) {
  const records=[];
  for(const spec of negativeRows){
    const consumer=resolve(work,spec.id),productRoot=resolve(consumer,'node_modules/virtual-bash');fs.mkdirSync(productRoot,{recursive:true});save(resolve(consumer,'package.json'),{private:true,type:'module'});
    for(const row of packageFiles){const bytes=fs.readFileSync(resolve(packageRoot,safe(row.path)));assert.equal(fileHash(resolve(packageRoot,row.path)),row.sha256);const target=resolve(productRoot,row.path);write(target,bytes);fs.chmodSync(target,row.mode);}
    const metadata=resolve(productRoot,'package.json'),pkg=JSON.parse(fs.readFileSync(metadata));
    if(spec.id==='N01')fs.writeFileSync(resolve(productRoot,'dist/index.js'),'export const deliberatelyMissingRootExport = true;\n');
    if(spec.id==='N02'){delete pkg.exports['./commands/timeout'];fs.writeFileSync(metadata,JSON.stringify(pkg));}
    if(spec.id==='N03'){pkg.exports['./commands/timeout'].import='./dist/index.js';fs.writeFileSync(metadata,JSON.stringify(pkg));}
    if(spec.id==='N04')fs.unlinkSync(resolve(productRoot,'dist/commands/timeout/index.js'));
    if(spec.id==='N05')fs.unlinkSync(resolve(productRoot,'dist/commands/timeout/index.d.ts'));
    const originalLeafHash=packageFiles.find(row=>row.path==='dist/commands/timeout/index.js').sha256;
    if(spec.id==='N06')fs.appendFileSync(resolve(productRoot,'dist/commands/timeout/index.js'),'\nvoid 0;\n');
    guarded.set(productRoot,inventory(productRoot));const record={id:spec.id,kind:spec.kind,status:'PASS'};
    if(spec.id==='N05'){
      write(resolve(consumer,'consumer.ts'),"import { createTimeoutCommand } from 'virtual-bash/commands/timeout';\ncreateTimeoutCommand();\n");
      save(resolve(consumer,'tsconfig.json'),{compilerOptions:{strict:true,module:'NodeNext',moduleResolution:'NodeNext',noEmit:true,skipLibCheck:false,typeRoots:[compilerTypeRoots],types:['node']},files:['consumer.ts']});
      const result=await tool(spec.id,compiler,['--pretty','false','-p',resolve(consumer,'tsconfig.json')],consumer,10000);record.result={code:result.code,stdout:result.stdout,stderr:result.stderr};
      const permitted=new Map(Object.entries(toolMap));for(const row of inventory(productRoot))permitted.set(resolve(productRoot,row.path),row.sha256);for(const name of ['consumer.ts','tsconfig.json','package.json'])permitted.set(resolve(consumer,name),fileHash(resolve(consumer,name)));
      for(const row of result.records.filter(item=>item.kind==='actual-file-read')){assert.ok(permitted.has(row.path),'NEGATIVE_TYPE_SOURCE_FALLBACK');assert.equal(row.sha256,permitted.get(row.path),'NEGATIVE_TYPE_HASH');}
      try{assert.equal(result.code,2);assert.equal(result.stderr,'');assert.match(result.stdout,/^consumer\.ts\(1,\d+\): error TS7016: /u);assert.ok(result.stdout.includes(spec.meaning));assert.equal((result.stdout.match(/error TS/gu)??[]).length,1);assert.ok(result.records.some(row=>row.kind==='actual-file-read'&&row.path===metadata&&row.sha256===fileHash(metadata)));}catch(error){record.status='FAIL';record.failure=reason(error);}
    }else{
      const output=resolve(raw,spec.id);fs.mkdirSync(output);const entry=resolve(consumer,'negative.mjs');write(entry,fs.readFileSync(resolve(recipe,'negative-worker.mjs')));
      const loads=helperLoads();loads[entry]=fileHash(entry);for(const row of inventory(productRoot))if(row.path.endsWith('.js'))loads[resolve(productRoot,row.path)]=row.sha256;if(spec.id==='N06')loads[resolve(productRoot,'dist/commands/timeout/index.js')]=originalLeafHash;
      const config={profile:'negative-installed',candidate,executionAuthorized:true,productRoot,consumerEntry:entry,loads,trace:resolve(output,'loads.jsonl'),output,negative:spec};const filename=resolve(work,`${spec.id}-config.json`);save(filename,config);
      const result=await child(spec.id,['--permission',`--allow-fs-read=${owned}`,`--allow-fs-write=${output}`,'--import',resolve(recipe,'preload.mjs'),entry],consumer,{TIMEOUT_CONFIG:filename,TIMEOUT_CONFIG_SHA256:fileHash(filename)});
      const trace=fs.readFileSync(config.trace,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);record.observation=JSON.parse(fs.readFileSync(resolve(output,'NEGATIVE.json')));record.trace=trace;
      try{assert.equal(result.code,0);assert.equal(result.stderr,'');assert.equal(record.observation.caught.code,spec.code);assert.ok(record.observation.caught.message.includes(spec.message));if(['N02','N04','N06','N07'].includes(spec.id))assert.equal(trace.filter(row=>row.kind==='actual-module-load'&&row.path.startsWith(`${productRoot}/`)).length,0,'PRODUCT_LOAD_BEFORE_GUARD');if(spec.id==='N07')assert.ok(trace.some(row=>row.kind==='strict-load-allowlist-denial'&&row.path===resolve(repository,'src/index.ts')&&row.beforeProductLoad));}catch(error){record.status='FAIL';record.failure=reason(error);}
    }
    records.push(record);save(resolve(raw,`${spec.id}-QUALIFIED.json`),record);
  }
  return records;
}

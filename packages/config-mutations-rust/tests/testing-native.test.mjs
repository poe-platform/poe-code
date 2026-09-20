import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as reference from '../../config-mutations/dist/testing/index.js';
test('testing export matches SDK codecs and symbols with no production SDK',async()=>{
 const rust=await import('@poe-code/config-mutations-rust/testing');assert.deepEqual(Object.keys(rust).sort(),Object.keys(reference).sort());
 for(const [parse,serialize,source]of [['parseJson','serializeJson','{ // comment\n"enabled":true}'],['parseToml','serializeToml','enabled=true\n'],['parseYaml','serializeYaml','enabled: true\n']]){assert.deepEqual(rust[parse](source),reference[parse](source));assert.equal(rust[serialize]({enabled:true,nested:{keep:'🦀'}}),reference[serialize]({enabled:true,nested:{keep:'🦀'}}));}
});
async function exercise(create){
 const fs=create({'~/config/file':'before','~./raw':'raw','relative/file':'relative'},'/home/k'),events=[];
 const call=async(method,...args)=>{try{const value=await fs[method](...args);events.push([method,Buffer.isBuffer(value)?['buffer',value.toString('utf8')]:value&&typeof value.isSymbolicLink==='function'?['link',value.isSymbolicLink()]:value]);}catch(e){events.push([method,{code:e.code,message:e.message}]);}};
 for(const path of ['~/config/file','~/config','~/missing']){events.push(['exists',path,fs.exists(path),fs.getContent(path)]);await call('readFile',path);await call('readFile',path,'utf8');await call('stat',path);await call('lstat',path);await call('readdir',path);await call('chmod',path,0o700);}
 await call('writeFile','~/config/file','collision',{flag:'wx'});await call('writeFile','~/missing/file','missing');await call('mkdir','~/missing/file');await call('mkdir','~/missing/file',{recursive:true});await call('writeFile','~/missing/file/data',Buffer.from('🦀'));await call('readFile','~/missing/file/data','utf8');
 await call('writeFile','~/config/view',new Uint8Array([65,66,67]).subarray(1));await call('rename','~/config/view','~/arbitrary/target');await call('readFile','~/arbitrary/target','utf8');await call('unlink','~/arbitrary/target');await call('unlink','~/arbitrary/target');await call('rename','~/absent','~/target');await call('mkdir','/');
 fs.files['/home/k/manual']='manual';fs.directories.add('/home/k/manual-dir');await call('stat','~/manual');await call('lstat','~/manual-dir');await call('readdir','~');
 return {events,files:fs.files,directories:[...fs.directories],keys:Object.keys(fs)};
}
test('Rust mock policy matches mutable SDK files, directories, path expansion, buffers and errors',async()=>{const {createMockFs}=await import('@poe-code/config-mutations-rust/testing');assert.deepEqual(await exercise(createMockFs),await exercise(reference.createMockFs));});
test('Rust mock policy preserves lazy option and prototype membership effects',async()=>{
 const {createMockFs}=await import('@poe-code/config-mutations-rust/testing');
 async function run(create){const fs=create({'~/file':'before'},'/home/k'),events=[];Object.setPrototypeOf(fs.files,new Proxy({},{has(target,key){events.push(['has',key]);return Reflect.has(target,key);}}));const has=fs.directories.has;fs.directories.has=function(path){events.push(['directory',path]);return has.call(this,path);};const options={get flag(){events.push('flag');return 'w';},get encoding(){throw Error('unused encoding');}};await fs.writeFile('~/file','after',options);await fs.mkdir('~/nested',{get recursive(){events.push('recursive');return true;}});assert.equal(fs.exists('~/absent'),false);return events;}
 assert.deepEqual(await run(createMockFs),await run(reference.createMockFs));
});
test('mock filesystem runs the full Rust mutation SDK without physical fixture files',async()=>{
 const {createMockFs,parseJson}=await import('@poe-code/config-mutations-rust/testing'),{runMutations,configMutation,fileMutation}=await import('@poe-code/config-mutations-rust');const fs=createMockFs();
 await runMutations([fileMutation.ensureDirectory({path:'~/config'}),configMutation.merge({target:'~/config/agent.json',value:{enabled:true}}),fileMutation.backup({target:'~/config/agent.json',once:true}),configMutation.transform({target:'~/config/agent.json',transform:doc=>({content:{...doc,enabled:false},changed:true})}),fileMutation.restoreBackup({target:'~/config/agent.json'})],{fs,homeDir:'/home/test'});
 assert.deepEqual(parseJson(fs.getContent('~/config/agent.json')),{enabled:true});assert.deepEqual(await fs.readdir('~/config'),['agent.json']);
});

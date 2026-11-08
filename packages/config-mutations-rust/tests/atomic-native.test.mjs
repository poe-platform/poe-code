import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Volume,createFsFromVolume} from 'memfs';
import {writeAtomically} from '../dist/io.js';
function fixture(){const volume=Volume.fromJSON({'/home/k/target':'before'}),fs=createFsFromVolume(volume).promises,events=[],wrapped={};for(const method of ['lstat','writeFile','rename','unlink'])wrapped[method]=async(...args)=>{events.push([method,...args]);return fs[method](...args);};return {volume,events,context:{fs:wrapped,homeDir:'/home/k'}};}
const temp={temporaryPath:()=>'/home/k/temp'};
test('native atomic writes exclusively and renames after checking both paths',async()=>{
 const f=fixture();await writeAtomically(f.context,'/home/k/target','after',temp);assert.equal(f.volume.readFileSync('/home/k/target','utf8'),'after');assert.equal(f.volume.existsSync('/home/k/temp'),false);
 assert.deepEqual(f.events,[['lstat','/home/k/target'],['lstat','/home/k'],['lstat','/home/k/temp'],['lstat','/home/k'],['writeFile','/home/k/temp','after',{encoding:'utf8',flag:'wx'}],['rename','/home/k/temp','/home/k/target']]);
});
test('native atomic collisions preserve foreign temporary files and stop at ten',async()=>{
 const f=fixture();f.volume.writeFileSync('/home/k/temp','foreign');let generated=0;
 await assert.rejects(writeAtomically(f.context,'/home/k/target','after',{temporaryPath(){generated++;return '/home/k/temp';}}),e=>e.message==='Unable to create temporary mutation file for /home/k/target.');
 assert.equal(generated,10);assert.equal(f.events.filter(e=>e[0]==='unlink').length,0);assert.equal(f.volume.readFileSync('/home/k/temp','utf8'),'foreign');assert.equal(f.volume.readFileSync('/home/k/target','utf8'),'before');
});
test('native atomic write and rename failures clean temp and keep original errors',async()=>{
 for(const method of ['writeFile','rename']){
  const f=fixture(),error=Object.assign(Error('injected'),{code:'EPERM'});f.context.fs[method]=async(...args)=>{f.events.push([method,...args]);throw error;};
  await assert.rejects(writeAtomically(f.context,'/home/k/target','after',temp),e=>e===error);assert.equal(f.volume.existsSync('/home/k/temp'),false);assert.equal(f.events.at(-1)[0],'unlink');assert.equal(f.volume.readFileSync('/home/k/target','utf8'),'before');
 }
 const f=fixture(),error=Error('rename'),cleanup=Error('cleanup');f.context.fs.rename=async()=>{throw error;};f.context.fs.unlink=async()=>{throw cleanup;};await assert.rejects(writeAtomically(f.context,'/home/k/target','after',temp),e=>e===error);
});
test('native atomic rename collisions clean their own temp before retry',async()=>{
 const f=fixture(),rename=f.context.fs.rename;let calls=0;f.context.fs.rename=async(...args)=>{if(++calls===1){f.events.push(['rename',...args]);throw Object.assign(Error('collision'),{code:'EEXIST'});}return rename(...args);};
 await writeAtomically(f.context,'/home/k/target','after',temp);assert.equal(calls,2);assert.equal(f.events.filter(e=>e[0]==='unlink').length,1);assert.equal(f.volume.readFileSync('/home/k/target','utf8'),'after');
});
test('native atomic target and temp symlinks fail at the original cleanup boundaries',async()=>{
 for(const target of [true,false]){const f=fixture(),link=target?'/home/k/link':'/home/k/temp';f.volume.symlinkSync('/outside',link);
 await assert.rejects(writeAtomically(f.context,target?link:'/home/k/target','after',temp),e=>e.message===`Refusing mutation write through symbolic link: ${link}`);
 assert.equal(f.events.filter(e=>e[0]==='unlink').length,target?0:1);assert.equal(f.volume.readFileSync('/home/k/target','utf8'),'before');}
});
test('native atomic random-path and target stat exceptions do not clean unrelated paths',async()=>{
 for(const method of ['temporaryPath','lstat']){const f=fixture(),error=Error('identity');if(method==='lstat')f.context.fs.lstat=async()=>{throw error;};await assert.rejects(writeAtomically(f.context,'/home/k/target','after',{temporaryPath(){if(method==='temporaryPath')throw error;return '/home/k/temp';}}),e=>e===error);assert.equal(f.events.filter(e=>e[0]==='unlink').length,0);}
});
test('native atomic effect traces match the current SDK writer',async()=>{
 const {runMutations}=await import('../../config-mutations/dist/execution/run-mutations.js');
 const {mergePreservingComments}=await import('../../config-mutations/dist/formats/json.js');
 function normalize(value){if(typeof value==='string'&&value.includes('.mutation-tmp-'))return value.slice(0,value.indexOf('.mutation-tmp-'))+'.mutation-tmp-ID';if(Array.isArray(value))return value.map(normalize);return value;}
 const before='{"enabled":false}\n',after=mergePreservingComments(before,{enabled:true});
 for(const method of [null,'writeFile','rename','unlink'])for(const code of ['EPERM','EEXIST']){
  const a=fixture(),b=fixture(),error=Object.assign(Error('same failure'),{code});
  for(const f of [a,b]){
   f.volume.writeFileSync('/home/k/target',before);
   f.context.fs.readFile=createFsFromVolume(f.volume).promises.readFile;
   if(method==='unlink'){f.context.fs.rename=async(...args)=>{f.events.push(['rename',...args]);throw error;};}
   if(method)f.context.fs[method]=async(...args)=>{f.events.push([method,...args]);throw error;};
  }
  const outcome=async(action)=>{try{await action();return {ok:true};}catch(e){return {error:{name:e.name,message:e.message,code:e.code}};}};
  let generated=0;
  assert.deepEqual(await outcome(()=>writeAtomically(a.context,'/home/k/target',after,{temporaryPath:()=>'/home/k/target.mutation-tmp-native'+(++generated)})),await outcome(()=>runMutations([{kind:'configMerge',target:'~/target',format:'json',value:{enabled:true}}],b.context)));
  assert.deepEqual(a.events.map(normalize),b.events.map(normalize));
  assert.deepEqual(Object.fromEntries(Object.entries(a.volume.toJSON()).map(([k,v])=>[normalize(k),v])),Object.fromEntries(Object.entries(b.volume.toJSON()).map(([k,v])=>[normalize(k),v])));
 }
});
test('native atomic target and generation errors do not inspect collision codes',async()=>{
 const f=fixture(),error=Error('generation');Object.defineProperty(error,'code',{get(){throw Error('unnecessary collision lookup');}});
 await assert.rejects(writeAtomically(f.context,'/home/k/target','after',{temporaryPath(){throw error;}}),e=>e===error);
 const {runMutations}=await import('../../config-mutations/dist/execution/run-mutations.js');
 const a=fixture(),b=fixture();for(const g of [a,b]){g.volume.writeFileSync('/home/k/target','{}');g.context.fs.readFile=createFsFromVolume(g.volume).promises.readFile;const e=Error('target');Object.defineProperty(e,'code',{get(){g.events.push(['code']);return 'EPERM';}});g.context.fs.lstat=async(path)=>{g.events.push(['lstat',path]);throw e;};}
 await assert.rejects(writeAtomically(a.context,'/home/k/target','after',temp));await assert.rejects(runMutations([{kind:'configMerge',target:'~/target',format:'json',value:{enabled:true}}],b.context));assert.deepEqual(a.events,b.events);
});

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Volume,createFsFromVolume} from 'memfs';
import {runMutations as original} from '../../config-mutations/dist/execution/run-mutations.js';
import {runMutations as rust} from '../dist/execution.js';
function fixture(initial={},settings={}){
 const volume=Volume.fromJSON({'/home/k/keep':'value',...initial}),platform=createFsFromVolume(volume).promises,events=[];
 const fs={};for(const method of ['readFile','writeFile','mkdir','rename','unlink','rm','stat','lstat','readdir','chmod'])fs[method]=async(...args)=>{events.push([method,...args]);if(settings.fail?.[method])throw settings.fail[method];return platform[method](...args);};
 if(settings.noRm)delete fs.rm;if(settings.noChmod)delete fs.chmod;
 const context={fs,homeDir:'/home/k',dryRun:settings.dryRun,observers:{onStart(d){events.push(['start',d]);},onComplete(d,o){events.push(['complete',d,o]);},onError(d,e){events.push(['error',d,e.message]);}}};
 if(settings.mapper)context.pathMapper={mapTargetDirectory({targetDirectory}){events.push(['map',targetDirectory]);return settings.mapper;}};
 return {context,events,volume};
}
async function compare(mutations,initial,settings){
 const a=fixture(initial,settings),b=fixture(initial,settings);
 const outcome=async(fn,f)=>{try{return {result:await fn(mutations,f.context,{token:'context'})};}catch(e){return {error:{name:e.name,message:e.message,code:e.code}};}};
 assert.deepEqual(await outcome(rust,a),await outcome(original,b));assert.deepEqual(a.events,b.events);assert.deepEqual(a.volume.toJSON(),b.volume.toJSON());
}
test('native file mutations match injected filesystem calls, outcomes and dry runs',async()=>{
 for(const dryRun of [false,true]){
  for(const path of ['~/new/dir','~','~./hidden','~.','~name','~\\dir','~/../escape','~/a/../../escape','/absolute','',null])await compare([{kind:'ensureDirectory',path}],{}, {dryRun});
  for(const force of [false,true])for(const noRm of [false,true])for(const path of ['~/empty','~/filled','~/missing'])await compare([{kind:'removeDirectory',path,force}],{'/home/k/empty':null,'/home/k/filled/file':'x'},{dryRun,noRm});
  for(const mode of [0o644,0o755,0,0o100755,NaN,Infinity])for(const noChmod of [false,true])for(const target of ['~/keep','~/missing'])await compare([{kind:'chmod',target,mode}],{}, {dryRun,noChmod});
  for(const whenEmpty of [false,true])for(const content of ['',' \u{feff}\u{a0}\r\n','data','\u200b'])await compare([{kind:'removeFile',target:'~/remove',whenEmpty}],{'/home/k/remove':content},{dryRun});
 }
 await compare([{kind:'ensureDirectory',path:'~/new'},{kind:'removeFile',target:'~/keep'},{kind:'chmod',target:'~/new',mode:0o700}],{},{});
});
test('native path mapping and observer resolver order match original',async()=>{
 for(const path of ['~/file','~','~./hidden','~/nested/../file'])await compare([{kind:'ensureDirectory',path}],{}, {mapper:'/mapped'});
 function inputs(events){let count=0;return [{kind:'ensureDirectory',path(options){events.push(['resolver',++count,options.token]);return count===1?'~/pending':'~/actual';}},{kind:'removeFile',label:'Keep custom label',target:'~/missing'}];}
 const a=fixture(),b=fixture();assert.deepEqual(await rust(inputs(a.events),a.context,{token:'context'}),await original(inputs(b.events),b.context,{token:'context'}));assert.deepEqual(a.events,b.events);
 const error=Error('resolver error');for(const fn of [rust,original]){const f=fixture();await assert.rejects(fn([{kind:'chmod',target(){throw error;},mode:0o700}],f.context),e=>e===error);assert.equal(f.events[0][0],'start');assert.equal(f.events[1][0],'error');}
});
test('native remove guards reset regex state and keep exception identity',async()=>{
 for(const fn of [rust,original]){
  const f=fixture({'/home/k/remove':' \nabc\n '}),guard=/abc/g;guard.lastIndex=200;
  const result=await fn([{kind:'removeFile',target:'~/remove',whenContentMatches:guard,whenEmpty:true}],f.context);
  assert.equal(result.changed,false);assert.equal(guard.lastIndex,3);
  const error=Error('guard failure');const g=fixture();await assert.rejects(fn([{kind:'removeFile',target:'~/keep',whenContentMatches:{test(){throw error;}}}],g.context),e=>e===error);
 }
});
test('native write traversal rejects symlinks and filesystem failures preserve identity',async()=>{
 for(const kind of ['ensureDirectory','chmod'])for(const dryRun of [false,true]){
  const a=fixture(),b=fixture();a.volume.symlinkSync('/outside','/home/k/link');b.volume.symlinkSync('/outside','/home/k/link');
  const mutation={kind,path:'~/link/target',target:'~/link/target',mode:0o700};
  const message='Refusing mutation write through symbolic link: /home/k/link';
  a.context.dryRun=dryRun;b.context.dryRun=dryRun;
  await assert.rejects(rust([mutation],a.context),e=>e.message===message);await assert.rejects(original([mutation],b.context),e=>e.message===message);assert.deepEqual(a.events,b.events);
 }
 for(const code of ['ENOENT','EPERM'])for(const method of ['readFile','unlink','stat','lstat','mkdir','rm','readdir','chmod']){
  const error=Object.assign(Error('injected failure'),{code});
  const mutations={readFile:{kind:'removeFile',target:'~/keep'},unlink:{kind:'removeFile',target:'~/keep'},stat:{kind:'removeDirectory',path:'~/empty'},lstat:{kind:'chmod',target:'~/keep',mode:0o700},mkdir:{kind:'ensureDirectory',path:'~/new'},rm:{kind:'removeDirectory',path:'~/empty'},readdir:{kind:'removeDirectory',path:'~/empty'},chmod:{kind:'chmod',target:'~/keep',mode:0o700}};
  await compare([mutations[method]],{'/home/k/empty':null},{fail:{[method]:error}});
 }
 for(const fn of [rust,original]){const error=Object.assign(Object.create({code:'ENOENT'}),{message:'inherited code'}),f=fixture({}, {fail:{readFile:error}});await assert.rejects(fn([{kind:'removeFile',target:'~/keep'}],f.context),e=>e===error);}
});
test('native observers stop at the same boundaries and preserve thrown errors',async()=>{
 for(const name of ['onStart','onComplete','onError'])for(const fn of [rust,original]){
  const error=Error('observer failure'),f=fixture();f.context.observers[name]=()=>{throw error;};
  const mutation=name==='onError'?{kind:'chmod',target:'invalid',mode:1}:{kind:'ensureDirectory',path:'~/new'};
  await assert.rejects(fn([mutation],f.context),e=>e===error);
  assert.equal(f.events.filter(e=>e[0]==='mkdir').length,name==='onComplete'?1:0);
 }
});
test('native file execution reads operation controls lazily and observes async mutations',async()=>{
 for(const fn of [rust,original]){
  const f=fixture();const mutation={kind:'ensureDirectory',path:'~/new',get mode(){throw Error('unrelated mode');},get force(){throw Error('unrelated force');},get whenEmpty(){throw Error('unrelated guard');}};
  assert.equal((await fn([mutation],f.context)).changed,true);
  const g=fixture();const stat=g.context.fs.stat;g.context.fs.stat=async(...args)=>{g.context.dryRun=true;return stat(...args);};
  const result=await fn([{kind:'chmod',target:'~/keep',mode:0o700}],g.context);assert.equal(result.changed,true);assert.equal(g.events.filter(e=>e[0]==='chmod').length,0);
  const h=fixture();Object.defineProperty(h.context.fs,'rm',{get(){throw Error('unused rm');}});
  assert.equal((await fn([{kind:'removeDirectory',path:'~/missing'}],h.context)).changed,false);
  const i=fixture();await fn([{kind:'removeFile',target:'~/missing',get whenEmpty(){throw Error('unused guard');}}],i.context);
 }
});
test('native control getters and permission call mode keep original evaluation order',async()=>{
 function inputs(events,kind){const value={kind,path:'~/empty',target:'~/keep'};for(const [name,initial]of [['force',false],['whenEmpty',false],['whenContentMatches',/value/g]])Object.defineProperty(value,name,{get(){events.push(['control',name]);return initial;}});let mode=0o700;Object.defineProperty(value,'mode',{get(){events.push(['control','mode',mode]);return mode++;}});return value;}
 for(const kind of ['ensureDirectory','removeDirectory','removeFile','chmod']){
  const a=fixture({'/home/k/empty':null}),b=fixture({'/home/k/empty':null});
  for(const f of [a,b])Object.defineProperty(f.context,'dryRun',{get(){f.events.push(['control','dryRun']);return false;}});
  assert.deepEqual(await rust([inputs(a.events,kind)],a.context),await original([inputs(b.events,kind)],b.context));assert.deepEqual(a.events,b.events);assert.deepEqual(a.volume.toJSON(),b.volume.toJSON());
 }
});

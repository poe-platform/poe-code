import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Volume,createFsFromVolume} from 'memfs';
import {runMutations as original} from '../../config-mutations/dist/execution/run-mutations.js';
import {runMutations as rust} from '../dist/execution.js';
const realDate=Date,iso='2026-09-20T12:34:56.789Z',time=realDate.parse(iso);
function clock(){globalThis.Date=class extends realDate{constructor(...args){super(...args.length?args:[time]);}static now(){return time;}};return ()=>{globalThis.Date=realDate;};}
function fixture(initial={},settings={}){
 const volume=Volume.fromJSON({'/home/k/keep':'value',...initial}),platform=createFsFromVolume(volume).promises,events=[],fs={};
 for(const method of ['readFile','writeFile','mkdir','rename','unlink','rm','stat','lstat','readdir','chmod'])fs[method]=async(...args)=>{events.push([method,...args]);if(settings.fail?.[method])throw settings.fail[method];return platform[method](...args);};
 const context={fs,homeDir:'/home/k',dryRun:settings.dryRun,observers:{onStart(d){events.push(['start',d]);},onComplete(d,o){events.push(['complete',d,o]);},onError(d,e){events.push(['error',d,e.message]);}}};
 return {volume,events,context};
}
function normalize(value){if(typeof value==='string'&&value.includes('.mutation-tmp-'))return value.slice(0,value.indexOf('.mutation-tmp-'))+'.mutation-tmp-ID';if(Array.isArray(value))return value.map(normalize);return value;}
async function compare(mutations,initial,settings){
 const a=fixture(initial,settings),b=fixture(initial,settings),restore=clock();
 try{const outcome=async(fn,f)=>{try{return {result:await fn(mutations,f.context)};}catch(e){return {error:{name:e.name,message:e.message,code:e.code}};}};assert.deepEqual(await outcome(rust,a),await outcome(original,b));assert.deepEqual(a.events.map(normalize),b.events.map(normalize));assert.deepEqual(Object.fromEntries(Object.entries(a.volume.toJSON()).map(([k,v])=>[normalize(k),v])),Object.fromEntries(Object.entries(b.volume.toJSON()).map(([k,v])=>[normalize(k),v])));}finally{restore();}
}
test('native backup and restore match generated filenames, baselines, consumption and dry runs',async()=>{
 for(const dryRun of [false,true])for(const once of [false,true])for(const target of ['~/keep','~/missing','~/missing-parent/file','~'])await compare([{kind:'backup',target,once}],{}, {dryRun});
 for(const dryRun of [false,true])for(const initial of [{},{'/home/k/target':'changed','/home/k/target.backup-2026-09-19T10-20-30-000Z':'before'},{'/home/k/target':'changed','/home/k/target.backup-2026-09-19T10-20-30-000Z.missing':''}])await compare([{kind:'restoreBackup',target:'~/target'}],initial,{dryRun});
 await compare([{kind:'backup',target:'~/keep'},{kind:'backup',target:'~/keep'},{kind:'restoreBackup',target:'~/keep'},{kind:'restoreBackup',target:'~/keep'},{kind:'restoreBackup',target:'~/keep'}],{},{});
 await compare([{kind:'backup',target:'~/missing',once:true},{kind:'backup',target:'~/missing',once:true},{kind:'restoreBackup',target:'~/missing'}],{},{});
});
test('native backup selection matches SDK syntax, date admission and lexical collision ordering',async()=>{
 const names=['not-generated','2026-09-20T10-20-30-000Z','2026-09-20T10-20-30-000Z-2','2026-09-20T10-20-30-000Z-10','2026-09-20T10-20-30-000Z-9','2026-09-20T10-20-30-000Z.missing','2026-09-20T10-20-30-000Z.missing-1','2026-09-20T10-20-30-000Z-x','2026-13-20T10-20-30-000Z','2026-02-31T10-20-30-000Z','2026-09-20T24-00-00-000Z','2026-09-20T24-00-00-001Z'];
 for(const name of names)for(const kind of ['backup','restoreBackup'])await compare([{kind,target:'~/target',once:true}],{'/home/k/target':'changed',[`/home/k/target.backup-${name}`]:'candidate'},{});
 await compare([{kind:'restoreBackup',target:'~/target'}],Object.fromEntries(names.map(name=>[`/home/k/target.backup-${name}`,name])),{});
});
test('native backup failures preserve error identity, cleanup and missing-code boundaries',async()=>{
 for(const code of ['EPERM','ENOENT'])for(const method of ['lstat','readFile','readdir','writeFile','rename','unlink'])for(const kind of ['backup','restoreBackup']){
  const error=Object.assign(Error('injected'),{code});await compare([{kind,target:'~/target',once:true}],{'/home/k/target':'changed','/home/k/target.backup-2026-09-19T10-20-30-000Z':'before'},{fail:{[method]:error}});
 }
 for(const fn of [rust,original]){const f=fixture(),error=Error('partial write'),write=f.context.fs.writeFile;f.context.fs.writeFile=async(...args)=>{await write(...args);throw error;};await assert.rejects(fn([{kind:'backup',target:'~/keep'}],f.context),e=>e===error);assert.equal(f.volume.readdirSync('/home/k').filter(name=>name.includes('.backup-')).length,0);}
});
test('native backup and restore reject write symlinks at the same boundaries',async()=>{
 for(const kind of ['backup','restoreBackup'])for(const dryRun of [false,true]){
  const a=fixture(),b=fixture(),name='keep.backup-2026-09-19T10-20-30-000Z';
  for(const f of [a,b]){f.context.dryRun=dryRun;f.volume.symlinkSync('/outside',kind==='backup'?'/home/k/link':`/home/k/${name}`);}
  const mutation={kind,target:kind==='backup'?'~/link/target':'~/keep'};
  const outcome=async(fn,f)=>{try{return await fn([mutation],f.context);}catch(e){return {message:e.message};}};
  assert.deepEqual(await outcome(rust,a),await outcome(original,b));assert.deepEqual(a.events.map(normalize),b.events.map(normalize));
 }
});
test('native backup controls and date predicates stay lazy and keep callback order',async()=>{
 function inputs(events){return [{kind:'backup',target:'~/missing',get once(){events.push(['once']);return true;}},{kind:'restoreBackup',target:'~/missing',get once(){throw Error('unused once');}}];}
 const a=fixture(),b=fixture(),restore=clock();try{for(const f of [a,b])Object.defineProperty(f.context,'dryRun',{get(){f.events.push(['dryRun']);return false;}});assert.deepEqual(await rust(inputs(a.events),a.context),await original(inputs(b.events),b.context));assert.deepEqual(a.events,b.events);}finally{restore();}
 const parse=Date.parse;
 for(const fn of [rust,original]){const f=fixture({'/home/k/keep.backup-2026-09-19T10-20-30-000Z-x':'invalid suffix','/home/k/keep.backup-2026-09-19T10-20-30-000Z':'before'}),dates=[];try{Date.parse=text=>{dates.push(text);return parse(text);};await fn([{kind:'backup',target:'~/keep',once:true}],f.context);assert.equal(dates.length,2);assert.deepEqual(dates,['2026-09-19T10:20:30.000Z','2026-09-19T10:20:30.000Z']);}finally{Date.parse=parse;}}
});
test('native file factories retain resolver and guard identity and match SDK option reads',async()=>{
 const {fileMutation}=await import('../dist/execution.js');const {fileMutation:reference}=await import('../../config-mutations/dist/mutations/file-mutation.js');
 const resolver=()=> '~/keep',guard=/value/g;
 for(const method of Object.keys(reference)){
  const events=[];const input={get path(){events.push('path');return resolver;},get target(){events.push('target');return resolver;},get mode(){events.push('mode');return 0o700;},get force(){events.push('force');return true;},get once(){events.push('once');return true;},get whenEmpty(){events.push('whenEmpty');return true;},get whenContentMatches(){events.push('whenContentMatches');return guard;},get label(){events.push('label');return 'Managed';},get unknown(){throw Error('unused option');}};
  const expected=reference[method](input),order=events.splice(0);const actual=fileMutation[method](input);assert.deepEqual(actual,expected);assert.deepEqual(events,order);assert.equal(actual.target??actual.path,resolver);if(actual.whenContentMatches)assert.equal(actual.whenContentMatches,guard);
 }
 assert.deepEqual(Object.keys(fileMutation),Object.keys(reference));
});
test('native backup retries 256 collisions and ignores cleanup code getters',async()=>{
 for(const fn of [rust,original]){
  const f=fixture(),write=f.context.fs.writeFile;let collisions=0;f.context.fs.writeFile=async(...args)=>{if(collisions++<256)throw Object.assign(Error('collision'),{code:'EEXIST'});return write(...args);};const restore=clock();try{assert.equal((await fn([{kind:'backup',target:'~/keep'}],f.context)).changed,true);assert.equal(f.volume.readFileSync('/home/k/keep.backup-2026-09-20T12-34-56-789Z-256','utf8'),'value');}finally{restore();}
  const g=fixture(),error=Error('write failure'),cleanup=Error('cleanup');Object.defineProperty(cleanup,'code',{get(){throw Error('unused cleanup code');}});g.context.fs.writeFile=async()=>{throw error;};g.context.fs.unlink=async()=>{throw cleanup;};await assert.rejects(fn([{kind:'backup',target:'~/keep'}],g.context),e=>e===error);
 }
});

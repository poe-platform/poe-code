import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Volume,createFsFromVolume} from 'memfs';
import {runMutations as original} from '../../config-mutations/dist/execution/run-mutations.js';
import {runMutations as rust} from '../dist/execution.js';
const realDate=Date,instant=realDate.parse('2026-09-20T12:34:56.789Z');
function fixture(initial={},settings={}){const volume=Volume.fromJSON({'/home/k/keep':'x',...initial}),platform=createFsFromVolume(volume).promises,events=[],fs={};for(const method of ['readFile','writeFile','mkdir','rename','unlink','rm','stat','lstat','readdir','chmod'])fs[method]=async(...args)=>{events.push([method,...args]);if(settings.fail?.[method])throw settings.fail[method];return platform[method](...args);};const context={fs,homeDir:'/home/k',dryRun:settings.dryRun,observers:{onStart(d){events.push(['start',d]);},onComplete(d,o){events.push(['complete',d,o]);},onError(d,e){events.push(['error',d,e.message]);}}};return {volume,events,context};}
function normalize(v){if(typeof v==='string'&&v.includes('.mutation-tmp-'))return v.slice(0,v.indexOf('.mutation-tmp-'))+'.mutation-tmp-ID';if(Array.isArray(v))return v.map(normalize);return v;}
async function compare(mutations,initial,settings){const a=fixture(initial,settings),b=fixture(initial,settings);globalThis.Date=class extends realDate{constructor(...args){super(...args.length?args:[instant]);}static now(){return instant;}};try{const outcome=async(fn,f)=>{try{return {result:await fn(mutations,f.context,{suffix:'context'})};}catch(e){return {error:{name:e.name,message:e.message,code:e.code}};}};assert.deepEqual(await outcome(rust,a),await outcome(original,b));assert.deepEqual(a.events.map(normalize),b.events.map(normalize));assert.deepEqual(Object.fromEntries(Object.entries(a.volume.toJSON()).map(([k,v])=>[normalize(k),v])),Object.fromEntries(Object.entries(b.volume.toJSON()).map(([k,v])=>[normalize(k),v])));}finally{globalThis.Date=realDate;}}
test('native configuration mutations match SDK reads, writes, formatting, empty deletes and dry runs',async()=>{
 for(const [format,content]of [['json','{ // keep\n "enabled": false, "nested": {"keep":1,"remove":2}, "items":[1,2]\n}\n'],['toml','enabled = false\nitems = [1,2]\n[nested]\nkeep = 1\nremove = 2\n'],['yaml','enabled: false\nnested:\n  keep: 1\n  remove: 2\nitems:\n  - 1\n  - 2\n']])for(const dryRun of [false,true]){
  const target=`~/file.${format}`,initial={[`/home/k/file.${format}`]:content};
  for(const value of [{enabled:true,nested:{add:3},items:['new']},{},{added:'<K>&'},context=>({context:context.suffix})])await compare([{kind:'configMerge',target,value}],initial,{dryRun});
  for(const shape of [{nested:{remove:null}},{nested:{}},{absent:null},{enabled:null,nested:null,items:null}])await compare([{kind:'configPrune',target,shape}],initial,{dryRun});
  for(const transform of [doc=>({content:{...doc,enabled:true},changed:true}),()=>({content:null,changed:true}),doc=>({content:doc,changed:false}),doc=>({content:doc,changed:true}),doc=>{doc.enabled=true;return {content:doc,changed:true};}])await compare([{kind:'configTransform',target,transform}],initial,{dryRun});
 }
});
test('native missing and malformed documents preserve recovery, backup collisions and guard admission',async()=>{
 for(const format of ['json','toml','yaml'])for(const dryRun of [false,true])for(const existed of [false,true]){
  const target=`~/file.${format}`,initial=existed?{[`/home/k/file.${format}`]:format==='json'?'{broken':format==='toml'?'=broken':'broken: [value'}:{};
  for(const mutation of [{kind:'configMerge',target,value:{enabled:true}},{kind:'configPrune',target,shape:{enabled:null},onlyIf(){throw Error('unused guard');}},{kind:'configTransform',target,transform:doc=>({content:{...doc,enabled:true},changed:true})},{kind:'configTransform',target,transform:()=>({content:null,changed:true})}])await compare([mutation],initial,{dryRun});
 }
 await compare([{kind:'configMerge',target:'~/file.json',value:{}},{kind:'configMerge',target:'~/file.json',value:{enabled:true}}],{'/home/k/file.json':'{bad','/home/k/file.json.invalid-2026-09-20T12-34-56-789Z.json':'first'},{});
 for(const onlyIf of [()=>false,()=>true])await compare([{kind:'configPrune',target:'~/file.json',shape:{enabled:null},onlyIf}],{'/home/k/file.json':'{"enabled":true}\n'},{});
});
test('native format and value validation happen at the same lazy stages',async()=>{
 for(const kind of ['configMerge','configPrune','configTransform'])for(const format of [undefined,'json','file.YML','unknown',''])for(const existed of [false,true])await compare([{kind,target:'~/file',format,value:{enabled:true},shape:{enabled:null},transform:()=>({content:null,changed:true})}],existed?{'/home/k/file':'{}\n'}:{},{});
 for(const value of [null,undefined,0,'x',[],new Date()])await compare([{kind:'configMerge',target:'~/file.json',value}],{},{});
 for(const fn of [rust,original]){const f=fixture(),error=Error('resolver');await assert.rejects(fn([{kind:'configMerge',target:'~/file.json',value(){throw error;}}],f.context),e=>e===error);}
});
test('native configuration host failures and invalid backup symlinks preserve cleanup and error identity',async()=>{
 for(const kind of ['configMerge','configPrune','configTransform'])for(const method of ['readFile','writeFile','rename','unlink','lstat'])for(const code of ['EPERM','ENOENT']){
  const error=Object.assign(Error('injected'),{code});await compare([{kind,target:'~/file.json',value:{enabled:true},shape:{enabled:null},transform:()=>({content:null,changed:true})}],{'/home/k/file.json':'{"enabled":false}\n'},{fail:{[method]:error}});
 }
 for(const fn of [rust,original]){const f=fixture({'/home/k/file.json':'{bad'}),backup='/home/k/file.json.invalid-2026-09-20T12-34-56-789Z.json';f.volume.symlinkSync('/outside',backup);globalThis.Date=class extends realDate{constructor(...args){super(...args.length?args:[instant]);}};try{await assert.rejects(fn([{kind:'configMerge',target:'~/file.json',value:{enabled:true}}],f.context),e=>e.message===`Refusing mutation write through symbolic link: ${backup}`);assert.equal(f.events.filter(e=>e[0]==='unlink').length,0);}finally{globalThis.Date=realDate;}}
});
test('native prefix pruning keeps recursive prefix map, shallow replacement, reference identity and proto safety',async()=>{
 const content='{"servers":{"old-a":{"nested":{"first":1}},"keep":{"nested":{"first":1}}},"group":{"servers":{"old-b":1,"keep":2}}}\n';
 await compare([{kind:'configMerge',target:'~/file.json',value:{servers:{keep:{nested:{second:2}},added:3},group:{servers:{added:4}}},pruneByPrefix:{servers:'old-'}}],{'/home/k/file.json':content},{});
 await compare([{kind:'configMerge',target:'~/file.json',value:JSON.parse('{"__proto__":{"safe":true},"constructor":{"prototype":{"safe":true}}}'),pruneByPrefix:{other:'prefix'}}],{'/home/k/file.json':'{}\n'},{});
});
test('native configuration getters, resolver options and formatter calls retain original evaluation order',async()=>{
 function mutations(events,kind){const value={kind,target:'~/file.json',get format(){events.push(['format']);return 'json';},get value(){events.push(['value']);return options=>{events.push(['resolveValue',options.suffix]);return {enabled:true};};},get shape(){events.push(['shape']);return options=>{events.push(['resolveShape',options.suffix]);return {enabled:null};};},get onlyIf(){events.push(['onlyIf']);return function(doc,options){events.push(['guard',doc.enabled,options.suffix,this===value]);return true;};},get pruneByPrefix(){events.push(['prefix']);return {other:'old-'};},transform(doc,options){events.push(['transform',doc.enabled,options.suffix,this===value]);return {content:{...doc,enabled:true},changed:true};}};return [value];}
 for(const kind of ['configMerge','configPrune','configTransform']){const a=fixture({'/home/k/file.json':'{"enabled":false}\n'}),b=fixture({'/home/k/file.json':'{"enabled":false}\n'});for(const f of [a,b])Object.defineProperty(f.context,'dryRun',{get(){f.events.push(['dryRun']);return false;}});assert.deepEqual(await rust(mutations(a.events,kind),a.context,{suffix:'context'}),await original(mutations(b.events,kind),b.context,{suffix:'context'}));assert.deepEqual(a.events.map(normalize),b.events.map(normalize));}
});
test('native configuration factories retain transforms and guards and match SDK option reads',async()=>{
 const {configMutation}=await import('../dist/execution.js');const {configMutation:reference}=await import('../../config-mutations/dist/mutations/config-mutation.js');
 const resolver=()=> '~/file.json',transform=doc=>({content:doc,changed:true}),guard=()=>true;
 for(const method of Object.keys(reference)){const events=[],input={get target(){events.push('target');return resolver;},get value(){events.push('value');return resolver;},get shape(){events.push('shape');return resolver;},get format(){events.push('format');return 'json';},get pruneByPrefix(){events.push('prefix');return {servers:'old-'};},get onlyIf(){events.push('onlyIf');return guard;},get transform(){events.push('transform');return transform;},get label(){events.push('label');return 'Managed';},get unknown(){throw Error('unused option');}};const expected=reference[method](input),order=events.splice(0),actual=configMutation[method](input);assert.deepEqual(actual,expected);assert.deepEqual(events,order);assert.equal(actual.target,resolver);if(actual.transform)assert.equal(actual.transform,transform);if(actual.onlyIf)assert.equal(actual.onlyIf,guard);}
 assert.deepEqual(Object.keys(configMutation),Object.keys(reference));
});

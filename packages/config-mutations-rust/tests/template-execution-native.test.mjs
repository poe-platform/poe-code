import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Volume,createFsFromVolume} from 'memfs';
import {runMutations as original} from '../../config-mutations/dist/execution/run-mutations.js';
import {runMutations as rust} from '../dist/execution.js';
const realDate=Date,instant=realDate.parse('2026-09-20T12:34:56.789Z');
function fixture(initial,templates,events){const volume=Volume.fromJSON({'/home/k/keep':'x',...initial}),platform=createFsFromVolume(volume).promises,fs={};for(const method of ['readFile','writeFile','mkdir','rename','unlink','rm','stat','lstat','readdir','chmod'])fs[method]=async(...args)=>{events.push([method,...args]);return platform[method](...args);};return {volume,context:{fs,homeDir:'/home/k',templates,observers:{onStart(d){events.push(['start',d]);},onComplete(d,o){events.push(['complete',d,o]);},onError(d,e){events.push(['error',d,e.message]);}}}};}
function normalize(v){if(typeof v==='string'&&v.includes('.mutation-tmp-'))return v.slice(0,v.indexOf('.mutation-tmp-'))+'.mutation-tmp-ID';if(Array.isArray(v))return v.map(normalize);return v;}
async function compare(build,initial,settings={}){const a=[],b=[],left=fixture(initial,settings.templates,a),right=fixture(initial,settings.templates,b);left.context.dryRun=right.context.dryRun=settings.dryRun;globalThis.Date=class extends realDate{constructor(...args){super(...args.length?args:[instant]);}};try{const outcome=async(fn,f,events)=>{try{return {result:await fn(build(events),f.context,{name:'option'})};}catch(e){return {error:{name:e.name,message:e.message,cause:e.cause?.message}};}};assert.deepEqual(await outcome(rust,left,a),await outcome(original,right,b));assert.deepEqual(a.map(normalize),b.map(normalize));assert.deepEqual(left.volume.toJSON(),right.volume.toJSON());}finally{globalThis.Date=realDate;}}
test('native template write matches SDK rendering, resolver order and all outcomes',async()=>{
 for(const dryRun of [false,true])for(const current of [undefined,'old','<K> &lt;K&gt;'])await compare(events=>[{kind:'templateWrite',target:options=>{events.push(['target',options.name]);return '~/file';},templateId:'agent',context:options=>{events.push(['context',options.name]);return {name:'<K>'};}}],current===undefined?{}:{'/home/k/file':current},{dryRun,templates:async()=> '{{{name}}} {{name}}'});
});
test('native template merge uses full JSON/TOML serialization and invalid current backup',async()=>{
 for(const [kind,template,current]of [['templateMergeJson','{"added":"{{name}}"}','{ // discard comments\n"keep":true}\n'],['templateMergeToml','added="{{name}}"','keep=true\n']])for(const dryRun of [false,true])for(const source of [undefined,current,'{{broken'])await compare(()=>[{kind,target:'~/file',templateId:'agent',context:{name:'<K>'}}],source===undefined?{}:{'/home/k/file':source},{dryRun,templates:async()=>template});
});
test('native missing template loader rejects before application target resolver',async()=>{
 for(const kind of ['templateWrite','templateMergeJson','templateMergeToml'])await compare(events=>[{kind,target(){events.push('target');return '~/file';},templateId:'agent',context(){throw Error('unused context');}}],{});
});
test('native template getter receivers, lazy loader and foreign errors match SDK',async()=>{
 for(const fn of [rust,original]){const error=Error('foreign loader'),events=[],f=fixture({},undefined,events),mutation={kind:'templateWrite',target:'~/file',templateId:'agent'};f.context.templates=function(){assert.equal(this,f.context);throw error;};await assert.rejects(fn([mutation],f.context),e=>e===error);}
 for(const kind of ['templateWrite','templateMergeJson','templateMergeToml'])await compare(events=>[{kind,target:'~/file',get templateId(){events.push('templateId');return 'agent';},get context(){events.push('context');return options=>{events.push(['resolveContext',options.name]);return {};};}}],{},{templates:async()=> '{{broken'});
});
test('native template parse errors preserve cause and do not read current',async()=>{
 for(const kind of ['templateMergeJson','templateMergeToml'])await compare(()=>[{kind,target:'~/file',templateId:'agent'}],{'/home/k/file':'existing'},{templates:async()=> '{{broken'});
 for(const kind of ['templateMergeJson','templateMergeToml'])await compare(()=>[{kind,target:'~/file',templateId:'agent'}],{'/home/k/file':'existing'},{templates:async()=> '= invalid'});
});
test('native template factories match SDK layouts and foreign option identities',async()=>{
 const {templateMutation}=await import('../dist/execution.js'),{templateMutation:reference}=await import('../../config-mutations/dist/mutations/template-mutation.js');
 for(const method of Object.keys(reference)){const events=[],resolver=()=> '~/file',context=()=>({name:'K'}),options={get target(){events.push('target');return resolver;},get templateId(){events.push('templateId');return 'agent';},get context(){events.push('context');return context;},get label(){events.push('label');return 'Managed';},get unknown(){throw Error('unused');}};const expected=reference[method](options),order=events.splice(0),actual=templateMutation[method](options);assert.deepEqual(actual,expected);assert.deepEqual(events,order);assert.equal(actual.context,context);assert.equal(actual.target,resolver);}
 assert.deepEqual(Object.keys(templateMutation),Object.keys(reference));
});
test('native canonical template documents suppress writes and root rendering keeps raw variables',async()=>{
 for(const [kind,template,current]of [['templateWrite','',''],['templateMergeJson','{}','{}\n'],['templateMergeToml','','\n']])await compare(()=>[{kind,target:'~/file',templateId:'agent'}],{'/home/k/file':current},{templates:async()=>template});
 const {renderTemplate}=await import('../dist/template.js'),{renderTemplate:reference}=await import('../../config-mutations/dist/template/render.js');
 const variables={name:'<K>&',items:['🦀','second']},source='{{name}} {{#items}}[{{.}}]{{/items}}';assert.equal(renderTemplate(source,variables),reference(source,variables));
});
test('native template callbacks and target write failures preserve original error identity',async()=>{
 for(const fn of [rust,original])for(const stage of ['loader','context','render','readFile','writeFile','rename']){
  const events=[],error=Object.assign(Error(stage),{code:'EPERM'}),f=fixture({},async()=> '{{name}}',events),mutation={kind:'templateWrite',target:'~/file',templateId:'agent',context:{name:'K'}};
  if(stage==='loader')f.context.templates=async()=>{throw error;};
  else if(stage==='context')mutation.context=()=>{throw error;};
  else if(stage==='render')Object.defineProperty(mutation.context,'name',{get(){throw error;}});
  else f.context.fs[stage]=async()=>{throw error;};
  await assert.rejects(fn([mutation],f.context),e=>e===error);
 }
});

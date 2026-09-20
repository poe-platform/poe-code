import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,mergeLayers} from '../dist/index.js';
import {parseDocument as sdkParse,mergeLayers as sdkMerge} from '../../config-extends/dist/index.js';
import {native} from '../dist/native.js';
test('native document parsing retains date aliases after prompt replacement',()=>{
 const result=parseDocument('---\nprompt: &date !!timestamp 2026-01-01\nfirst: *date\nsecond: *date\n---\nBody','/tmp/config.md');
 assert.equal(result.data.prompt,'Body');assert.ok(result.data.first instanceof Date);assert.equal(result.data.first,result.data.second);
});
test('foreign merging retains opaque identities, null prototypes, sparse array maps and safe keys',()=>{
 const opaque=new Date(),plain=Object.assign(Object.create(null),{leaf:opaque}),array=[plain,,opaque];
 const high=JSON.parse('{"__proto__":{"owner":"safe"},"remove":null,"prompt":""}');high.items=array;
 const result=mergeLayers([{source:'high',data:high},{source:'low',data:{prompt:'inherited',remove:true}}]);
 assert.equal(result.data.items[2],opaque);assert.equal(Object.getPrototypeOf(result.data.items[0]),null);assert.equal(result.data.items[0].leaf,opaque);assert.equal(1 in result.data.items,false);assert.equal(result.data.__proto__.owner,'safe');assert.equal(result.data.prompt,'inherited');assert.equal(Object.hasOwn(result.data,'remove'),false);
});
test('foreign getter access order matches current SDK',()=>{
 const reads=[],child={get x(){reads.push('x');return 'leaf'}},root={get a(){reads.push('a');return child},get b(){reads.push('b');return 'sibling'}};
 mergeLayers([{source:'root',data:root}]);assert.deepEqual(reads,['a','b','x','a','x','b']);
});
test('timestamp scalar YAML root follows SDK object spreading',()=>{
 assert.deepEqual(parseDocument('!!timestamp 2026-01-01','/tmp/config.yaml'),sdkParse('!!timestamp 2026-01-01','/tmp/config.yaml'));
});
test('getter exceptions retain the original error identity and iterator cleanup',()=>{
 const failure=new Error('get denied'),root={get data(){throw failure}};
 assert.throws(()=>mergeLayers([{source:'root',data:root}]),error=>error===failure);
 const closes=[],array=[root];array[Symbol.iterator]=function*(){try{yield root;}finally{closes.push('closed');}};
 assert.throws(()=>mergeLayers([{source:'root',data:{array}}]),error=>error===failure);assert.deepEqual(closes,['closed']);
});
test('array custom map and species behavior match SDK',()=>{
 class Special extends Array{}
 const item={value:'copy'},array=new Special(item,undefined);const result=mergeLayers([{source:'root',data:{array}}]);const sdk=sdkMerge([{source:'root',data:{array}}]);
 assert.equal(result.data.array.constructor,Special);assert.deepEqual(result,sdk);assert.notEqual(result.data.array[0],item);
 const custom=[item];custom.map=mapper=>({mapped:mapper(item)});assert.deepEqual(mergeLayers([{source:'root',data:{array:custom}}]),sdkMerge([{source:'root',data:{array:custom}}]));
});
test('layer data and source getters are read at the same stages as the SDK',()=>{
 function fixture(){const calls=[],data={a:'leaf'};return {calls,layer:{get data(){calls.push('data');return data;},get source(){calls.push('source');return 'root';}}};}
 const first=fixture(),second=fixture();assert.deepEqual(mergeLayers([first.layer]),sdkMerge([second.layer]));assert.deepEqual(first.calls,second.calls);
});
test('ordinary data uses one owned merge call while retaining undefined and opaque values',()=>{
 const opaque=new Date(),symbol=Symbol('leaf'),data={nested:{value:'copy'},items:[undefined,{value:opaque}],negativeZero:-0,infinity:Infinity,nan:NaN,bigint:42n,symbol,skip:undefined,remove:null,prompt:''};
 const layers=[{source:'high',data},{source:'low',data:{prompt:'inherited',skip:'filled',remove:'ignored'}}];let calls=0;const original=native.extendsOwnedMerge;
 native.extendsOwnedMerge=function(...args){calls++;return original.apply(this,args);};
 try{const result=mergeLayers(layers);assert.deepEqual(result,sdkMerge(layers));assert.equal(result.data.items[1].value,opaque);assert.equal(result.data.symbol,symbol);assert.ok(Object.is(result.data.negativeZero,-0));assert.equal(Object.hasOwn(result.data.items,0),true);assert.equal(result.data.items[0],undefined);assert.equal(calls,1);}finally{native.extendsOwnedMerge=original;}
});
test('configuration root errors preserve lone UTF-16 units in filenames',()=>{
 const path='\ud800.yaml';let expected;try{sdkParse('hello',path);}catch(error){expected=error.message;}
 assert.throws(()=>parseDocument('hello',path),error=>error.message===expected);
});
test('changing the array prototype constructor retains species behavior',()=>{
 const descriptor=Object.getOwnPropertyDescriptor(Array.prototype,'constructor');class Other extends Array{}
 Object.defineProperty(Array.prototype,'constructor',{...descriptor,value:Other});
 try{const layers=[{source:'root',data:{items:[{value:'clone'}]}}];const result=mergeLayers(layers),expected=sdkMerge(layers);assert.equal(Object.getPrototypeOf(result.data.items),Object.getPrototypeOf(expected.data.items));assert.deepEqual(result,expected);}finally{Object.defineProperty(Array.prototype,'constructor',descriptor);}
});
test('excessive recursive foreign array mapping rejects with a bounded error',()=>{
 let value='leaf';for(let index=0;index<401;index++)value=[value];
 assert.throws(()=>mergeLayers([{source:'deep',data:{value}}]),{message:'Maximum foreign array depth exceeded (32).'});
});
test('wide owned layers preserve indexed priority, nested provenance and UTF-16 keys',()=>{
 const high=Object.fromEntries(Array.from({length:128},(_,index)=>[`field${index}`,index%3===0?null:index]));
 const low=Object.fromEntries(Array.from({length:128},(_,index)=>[`field${index}`,'lower']));
 high.nested=Object.fromEntries(Array.from({length:64},(_,index)=>[`child${index}`,index%2===0?undefined:index]));low.nested=Object.fromEntries(Array.from({length:64},(_,index)=>[`child${index}`,'inherited']));high['\ud800']='unit';high['literal.dot']='literal';
 const layers=[{source:'high',data:high},{source:'low',data:low}];assert.deepEqual(mergeLayers(layers),sdkMerge(layers));
});

test('async discovery suspends without replay and preserves filesystem exceptions',async()=>{
 const {findBase}=await import('../dist/index.js'),calls=[],failure=Object.assign(new Error('denied'),{code:'EACCES'});
 const fs={async readFile(file){calls.push(file);await Promise.resolve();if(file.endsWith('.yaml'))return 'title: found';throw Object.assign(new Error('missing'),{code:'ENOENT'});}};
 assert.deepEqual(await findBase('job',['/bases'],fs),{content:'title: found',filePath:'/bases/job.yaml'});
 assert.deepEqual(calls,['/bases/job.md','/bases/job.yaml']);
 await assert.rejects(findBase('job',['/bases'],{async readFile(){throw failure}}),error=>error===failure);
});
test('async resolver retains opaque identities and defers original data getters',async()=>{
 const {resolve}=await import('../dist/index.js'),calls=[],failure=new Error('getter failed');
 const chain=[{source:'override',get data(){calls.push('data');return {settings:{own:true},get late(){throw failure}};}},{source:'document',filePath:'/work/job.yaml',content:'extends: true\nsettings: scalar\ndate: &d !!timestamp 2026-01-01\nfirst: *d\nsecond: *d'},{source:'base',path:'/bases'}];
 const fs={async readFile(){assert.equal(calls.includes('data'),false);calls.push('read');return '---\nsettings:\n  inherited: true\n---\nHello {{name}}';}};
 await assert.rejects(resolve(chain,{fs,view:{name:'World'}}),error=>error===failure);assert.equal(calls[0],'read');
 const result=await resolve(chain.slice(1),{fs:{async readFile(){return '---\nsettings:\n  inherited: true\n---\nHello {{name}}';}},view:{name(){return 'World'}}});
 assert.equal(result.data.prompt,'Hello World');assert.equal(result.data.first,result.data.second);assert.ok(result.data.date instanceof Date);
});
test('rooted async prompts return both template and rendered text with missing error identity',async()=>{
 const {resolvePromptDocument}=await import('../dist/index.js'),missing=Object.assign(new Error('original missing'),{code:'ENOENT'});
 const fs={async realpath(file){if(file==='/work/missing.md')throw missing;return file;},async readFile(){throw missing;}};
 const result=await resolvePromptDocument({cwd:'/work',filePath:'job.md',content:'---\nextends: true\n---\nDoc({{yield}})',baseDocuments:[{filePath:'/bases/job.md',content:'Base {{name}}'}],variables:{name:'World'},fs});
 assert.equal(result.template,'Doc(Base {{name}})');assert.equal(result.prompt,'Doc(Base World)');
 await assert.rejects(resolvePromptDocument({cwd:'/work',filePath:'missing.md',fs}),error=>error===missing);
});

test('concurrent async resolutions retain independent callbacks and reuse completed machines',async()=>{
 const {resolve}=await import('../dist/index.js');
 for(let round=0;round<8;round++){
  const results=await Promise.all(Array.from({length:24},(_,index)=>resolve([{source:`doc-${index}`,filePath:`/work/${index}.md`,content:'---\nextends: true\n---\nDoc({{yield}})'},{source:`base-${index}`,path:'/bases'}],{fs:{async readFile(file){await Promise.resolve();assert.equal(file,`/bases/${index}.md`);return `Base ${round}:${index} {{name}}`; }},view:{name:`view-${index}`}})));
  for(let index=0;index<results.length;index++){assert.equal(results[index].data.prompt,`Doc(Base ${round}:${index} view-${index})`);assert.equal(results[index].sources.prompt,`doc-${index}`);}
 }
});
test('rooted async canonical paths and overlays match SDK results, reads and failures',async()=>{
 const {resolvePromptDocument}=await import('../dist/index.js'),{resolvePromptDocument:sdk}=await import('../../config-extends/dist/index.js');
 const cases=[
  {cwd:'/work',filePath:'job.md'},
  {cwd:'/work',filePath:'missing.md',optional:true,baseDocuments:[{filePath:'/bases/missing.md',content:'Base {{name}}'}],variables:{name:'World'}},
  {cwd:'/work',filePath:'job.md',content:'---\nextends: ../outside/base.md\n---\nBody'},
  {cwd:'/work',filePath:'../outside/job.md',content:'Body'},
  {cwd:'/work',filePath:'job.md',content:'Body',basePaths:['relative']},
  {cwd:'/work',filePath:'job.md',content:'{{>snippet}}'},
  {cwd:'/work',filePath:'job.md',content:'{{required}}',validate:false},
  {cwd:'/work',filePath:'job.md',content:'{{required}}'},
 ];
 for(const canonical of ['/work','/canonical','/outside'])for(const options of cases){
  function fixture(){const calls=[],missing=Object.assign(new Error('missing fixture'),{code:'ENOENT'}),files=new Map([['/work/job.md','File {{name}}'],['/work/snippet.md','Partial {{name}}'],['/outside/base.md','Outside']]);return {calls,fs:{async realpath(file){calls.push(['realpath',file]);if(file==='/work')return canonical==='/outside'?'/work':canonical;if(files.has(file))return canonical+file.slice('/work'.length);throw missing;},async readFile(file){calls.push(['read',file]);if(files.has(file))return files.get(file);throw missing;}}};}
  const first=fixture(),second=fixture();let result,expected;
  try{result=await resolvePromptDocument({...options,fs:first.fs});}catch(error){result={error:error.message};}
  try{expected=await sdk({...options,fs:second.fs});}catch(error){expected={error:error.message};}
  assert.deepEqual(result,expected,JSON.stringify({canonical,options}));assert.deepEqual(first.calls,second.calls);
 }
});

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

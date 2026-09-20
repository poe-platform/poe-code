import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as json from '../dist/json.js';
import {createRequire} from 'node:module';
const oracle=createRequire(import.meta.url)('jsonc-parser');
function expectedEdit(source,path,value){
 const indent=source.match(/^[\t ]+/m)?.[0]??'  ';
 let result=oracle.applyEdits(source,oracle.modify(source,path,value,{formattingOptions:{tabSize:indent==='\t'?1:indent.length,insertSpaces:indent!=='\t',eol:'\n'}}));
 return result.endsWith('\n')?result:result+'\n';
}
test('native JSONC parse preserves UTF-16, numbers and safe own properties',()=>{
 for(const source of ['{}','null',' \uFEFF\u00A0','{"a":1,"a":2,"20":3,"2":4,}', '{/*before*/"text":"\uD800","arr":[1e400,-0,],}']){
  const expected=source.trim()?oracle.parse(source,[],{allowTrailingComma:true})??{}:{};
  assert.deepEqual(json.jsonFormat.parse(source),expected);
 }
 // The development JSONC SDK mutates the parsed prototype and loses this key.
 // The additive codec deliberately retains it as an ordinary own property.
 const proto='{"__proto__":{"polluted":true}}';
 assert.deepEqual(json.jsonFormat.parse(proto),JSON.parse(proto));
 assert.equal(Object.getPrototypeOf(json.jsonFormat.parse(proto)),Object.prototype);
 assert.equal(Object.prototype.polluted,undefined);
 assert.throws(()=>json.jsonFormat.parse('[]'),{message:'Expected JSON object.'});
 for(const source of ['{','{"a":1,','{"a":"\\q"}','{"a":[1,','{"a":1e}']){
  const errors=[];oracle.parse(source,errors,{allowTrailingComma:true});
  assert.throws(()=>json.jsonFormat.parse(source),{message:'JSON parse error: '+oracle.printParseErrorCode(errors[0].error)});
 }
});
test('targeted native edits agree with the development SDK and serialize host values once',()=>{
 let reads=0;const date=new Date('2020-01-02T03:04:05Z');
 const value={get date(){reads++;return date;},invalid:Infinity,missing:undefined,unicode:'\uD800'};
 const source='{\n  // retain\n  "a": 1,\n  "nested": {"old":true},\n  "list": [1,2,3]\n}';
 const expected=expectedEdit(source,['nested','next'],value);assert.equal(reads,1);
 assert.equal(json.modifyAtPath(source,['nested','next'],value),expected);assert.equal(reads,2);
 for(const path of [['a'],['new'],['nested','old'],['nested','absent'],['list',-1],['list',0],['list',1],['list',2],['list',20]]){
  for(const value of [true,{x:['text',3]},undefined]){
   if(value===undefined&&path[1]===20)continue;
   if(value===undefined&&path[1]===2)continue; // SDK last-item removal bug.
   assert.equal(json.modifyAtPath(source,path,value),expectedEdit(source,path,value),JSON.stringify(path));
  }
 }
 assert.deepEqual(json.jsonFormat.parse(json.removeAtPath(source,['list',2])).list,[1,2]);
});
test('invalid parents reject before value hooks and missing paths preserve toJSON keys',()=>{
 let calls=0;const value={toJSON(key){calls++;return key;}};
 const expected=expectedEdit('{}',['outer','inner'],value);assert.equal(calls,1);
 assert.equal(json.modifyAtPath('{}',['outer','inner'],value),expected);assert.equal(calls,2);
 calls=0;assert.throws(()=>json.modifyAtPath('{"scalar":1}',['scalar','child'],value));assert.equal(calls,0);
 const withPathHook=['outer'];withPathHook.toJSON=()=>['wrong'];
 assert.equal(json.modifyAtPath('{}',withPathHook,true),expectedEdit('{}',withPathHook,true));
});
test('V8 serialization preserves Date, toJSON, getters, holes and its errors',()=>{
 let calls=0;const value={date:new Date('2020-01-02Z'),get observed(){calls++;return {toJSON(){return 'custom';}};},array:[,undefined,Infinity,-0,'\uD800']};
 const expected=JSON.stringify(value,null,2)+'\n';assert.equal(calls,1);
 assert.equal(json.jsonFormat.serialize(value),expected);assert.equal(calls,2);
 const cycle={};cycle.self=cycle;assert.throws(()=>json.jsonFormat.serialize(cycle),TypeError);
 assert.throws(()=>json.jsonFormat.serialize({big:1n}),TypeError);
});
test('merge and prune retain patch identities and evaluate getters in original order',()=>{
 const date=new Date();const replacement={x:1};const array=[,date];const base={nested:{keep:1},array};
 const patch={nested:{next:2},new:replacement,array,ignored:undefined};
 const result=json.jsonFormat.merge(base,patch);
 assert.deepEqual(result,{nested:{keep:1,next:2},new:replacement,array});
 assert.notEqual(result.nested,base.nested);assert.equal(result.new,replacement);assert.equal(result.array,array);assert.equal(result.array[1],date);
 const copied=json.jsonFormat.merge(base,{});assert.notEqual(copied.array,array);assert.equal(0 in copied.array,false);assert.equal(copied.array[1],date);
 const cyclic={};cyclic.self=cyclic;assert.equal(json.jsonFormat.merge({},{opaque:cyclic}).opaque,cyclic);
 const unsafe=JSON.parse('{"__proto__":{"x":1}}');const merged=json.jsonFormat.merge({},unsafe);assert.equal(Object.getPrototypeOf(merged),Object.prototype);assert.equal(merged.__proto__,unsafe.__proto__);
 assert.deepEqual(json.jsonFormat.prune({empty:{},keep:1},{empty:{missing:1}}),{changed:false,result:{keep:1}});
 assert.deepEqual(json.jsonFormat.prune({a:{b:1,c:2},n:3},{a:{b:{}},n:{child:1}}),{changed:true,result:{a:{c:2},n:3}});
});
test('recursive updates preserve comments and skip structurally equal values',()=>{
 const source='{\n  // retained\n  "old": 1,\n  "nested": {"keep":true,"change":2},\n  "list": [1,2]\n}\n';
 const current=json.jsonFormat.parse(source);const next={nested:{keep:true,change:3},list:[1,2],new:{x:1}};
 let expected=expectedEdit(source,['old'],undefined);expected=expectedEdit(expected,['nested','change'],3);expected=expectedEdit(expected,['new'],{x:1});
 assert.equal(json.serializeUpdate(source,current,next),expected);
 assert.equal(json.mergePreservingComments(source,{nested:{change:3}}),expectedEdit(source,['nested','change'],3));
 assert.equal(json.serializeUpdate(source,current,current),source);
});
test('direct Rust serialization orders numeric keys and rejects excessive nesting',()=>{
 const native=createRequire(import.meta.url)('../dist/config-mutations-rust.node');
 for(const value of [{20:1,2:3,text:'\uD800'}, {array:[Infinity,-0,true,{}]}]){
  assert.equal(native.configJsonSerialize(JSON.stringify(value)),JSON.stringify(value,null,2)+'\n');
 }
 const deep='{"a":'.repeat(520)+'null'+'}'.repeat(520);
 assert.throws(()=>json.jsonFormat.parse(deep),{message:'JSON parse error: NestingLimitExceeded'});
 const source='{'+Array.from({length:4096},(_,i)=>JSON.stringify('key'+i)+':'+i).join(',')+'}';
 assert.deepEqual(json.jsonFormat.parse(source),JSON.parse(source));
 assert.equal(native.configJsonSerialize(source),JSON.stringify(JSON.parse(source),null,2)+'\n');
 const plan=native.configJsonPlan(source,['key0'],true);assert.equal(plan.wrappers.length,0);assert.equal(plan.replacesValue,true);
 assert.equal(json.jsonFormat.parse(plan.apply('3')).key0,3);assert.throws(()=>plan.apply('4'),{message:'JSON edit already consumed'});
 assert.throws(()=>plan.wrappers,{message:'JSON edit already consumed'});plan.discard();
 const discarded=native.configJsonPlan(source,['key0'],true);discarded.discard();assert.throws(()=>discarded.apply('4'),{message:'JSON edit already consumed'});
});

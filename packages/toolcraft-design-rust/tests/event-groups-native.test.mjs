import assert from "node:assert/strict";
import {test} from "node:test";
import * as native from "../dist/index.js";
import * as reference from "../../toolcraft-design/dist/event-groups.js";
const outcome=fn=>{try{return {value:fn()};}catch(error){return {error:[error?.constructor?.name,error?.message]};}};

test("event groups retain bounded children, insertion order, snapshots and visible windows",()=>{
  assert.equal(typeof native.createEventGroups,"function");
  function run(create) {
    const groups=create({capacity:2,children:2}),result=[];
    groups.append("a",{id:"one",text:"first"});groups.append("a",{id:"two",text:"second",error:true});
    const rows=groups.rows(0,20);rows[1].text="mutated";result.push(groups.rows(0,20));
    groups.append("a",{id:"one",text:"replacement"});groups.append("a",{id:"three",text:"x".repeat(20000)});
    groups.append("b",{id:"four",text:"four"});result.push(groups.rows(0,20));
    for(const offset of [-1,0,0.5,1,2,3,20,NaN,Infinity])for(const height of [-1,0,0.5,1,3,20,NaN,Infinity])result.push(groups.rows(offset,height));
    groups.toggle("a");result.push(groups.rows(0,20));groups.toggle("missing");
    groups.append("c",{id:"five",text:"five",error:true});result.push(groups.rows(0,20));
    return result;
  }
  assert.deepEqual(run(native.createEventGroups),run(reference.createEventGroups));
  for(const capacity of [0,-1,NaN,Infinity,1.5,"2"])for(const children of [0,1,NaN,"2"])assert.deepEqual(outcome(()=>native.createEventGroups({capacity,children})),outcome(()=>reference.createEventGroups({capacity,children})));
});

test("event rendering preserves markers, sanitation, width coercions and sparse species",()=>{
  assert.equal(typeof native.renderEventGroupRows,"function");
  for(const width of [-1,0,0.5,1,8,30,NaN,Infinity])for(const text of ["","First\nSecond\x1b[2J","界 e\u0301 👩‍💻\ud800"]){
    const rows=[{text,header:true,expanded:true},{text,header:true,expanded:false},{text,error:true},{text,error:false}];
    assert.deepEqual(native.renderEventGroupRows(rows,width),reference.renderEventGroupRows(rows,width));
  }
  function run(render) {
    const trace=[],row=new Proxy({header:false,error:true,text:"hello"},{get(target,key){trace.push(key);return target[key];}});
    class Rows extends Array {static get [Symbol.species](){trace.push("species");return Array;}}
    const rows=new Rows(2);rows[1]=row;
    return [render(rows,{valueOf(){trace.push("width");return 20;}}),trace];
  }
  assert.deepEqual(run(native.renderEventGroupRows),run(reference.renderEventGroupRows));
});

test("event append preserves getter ordering, setter capture and reentrant toggles",()=>{
  function run(create) {
    const trace=[],groups=create({capacity:2,children:2});
    const event=new Proxy({id:"one",text:"hello",error:false},{ownKeys(target){trace.push("keys");return Reflect.ownKeys(target);},getOwnPropertyDescriptor(target,key){trace.push(`descriptor:${key}`);return Reflect.getOwnPropertyDescriptor(target,key);},get(target,key){trace.push(`get:${key}`);if(key==="text")groups.toggle("a");return target[key];}});
    groups.append("a",event);return [groups.rows(0,10),trace];
  }
  assert.deepEqual(run(native.createEventGroups),run(reference.createEventGroups));
  const thrown={},groups=native.createEventGroups({capacity:2,children:2});
  assert.throws(()=>groups.append("a",{get id(){throw thrown;}}),error=>error===thrown);
  assert.deepEqual(groups.rows(0,2),[{id:"a",text:"a",groupId:"a",header:true,expanded:false}]);
});

test("event row iteration closes nested iterators on early exit and arbitrary throws",()=>{
  function run(create,fail=false) {
    const groups=create({capacity:2,children:2});groups.append("a",{id:"one",text:"one",error:true});groups.append("a",{id:"two",text:"two"});
    const trace=[],iterator=Map.prototype[Symbol.iterator],values=Map.prototype.values,thrown={};
    Map.prototype[Symbol.iterator]=function*(){try{yield* iterator.call(this);}finally{trace.push("groups closed");}};
    Map.prototype.values=function*(){try{yield* values.call(this);}finally{trace.push("children closed");}};
    let calls=0;const height={valueOf(){trace.push("height");if(fail&&++calls===2)throw thrown;return 2;}};
    try {const result=outcome(()=>groups.rows(0,height));return [result,trace];}finally{Map.prototype[Symbol.iterator]=iterator;Map.prototype.values=values;}
  }
  assert.deepEqual(run(native.createEventGroups),run(reference.createEventGroups));
  assert.deepEqual(run(native.createEventGroups,true),run(reference.createEventGroups,true));
});

test("event group subpaths, method descriptors and detached methods match",async()=>{
  const module=await import("toolcraft-design-rust/event-groups");
  assert.deepEqual(Object.keys(module),Object.keys(reference));
  for(const key of Object.keys(module)) {
    assert.equal(module[key],native[key]);assert.equal(module[key].name,reference[key].name);assert.equal(module[key].length,reference[key].length);
  }
  const a=native.createEventGroups({capacity:1,children:1}),b=reference.createEventGroups({capacity:1,children:1});
  assert.deepEqual(Object.keys(a),Object.keys(b));
  for(const key of Object.keys(a)) {
    const left=Object.getOwnPropertyDescriptor(a,key),right=Object.getOwnPropertyDescriptor(b,key);
    assert.deepEqual({...left,value:null},{...right,value:null});assert.equal(a[key].length,b[key].length);assert.equal(a[key].name,b[key].name);
    assert.equal(Object.hasOwn(a[key],"prototype"),Object.hasOwn(b[key],"prototype"));
  }
  const append=a.append,rows=a.rows;append("x",{id:"x",text:"hello"});assert.equal(rows(0,1)[0].id,"x");
});

test("event publication captures setter before event getters replace it",()=>{
  function run(create) {
    const groups=create({capacity:1,children:1}),set=Map.prototype.set,trace=[];
    groups.append("a",{id:"old",text:"old"});
    Map.prototype.set=function(...args){trace.push("captured");return set.apply(this,args);};
    const event={get id(){Map.prototype.set=function(...args){trace.push("replaced");return set.apply(this,args);};return "one";},text:"one",error:true};
    try{groups.append("a",event);return [groups.rows(0,2),trace];}finally{Map.prototype.set=set;}
  }
  assert.deepEqual(run(native.createEventGroups),run(reference.createEventGroups));
});

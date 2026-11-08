import assert from "node:assert/strict";
import {test} from "node:test";
import * as native from "../dist/index.js";
import * as reference from "../../toolcraft-design/dist/task-tree.js";
const outcome=fn=>{try{return {value:fn()};}catch(error){return {error:[error?.constructor?.name,error?.message]};}};

test("task trees preserve hierarchy, reparenting, insertion order and bounded windows",()=>{
  assert.equal(typeof native.createTaskTree,"function");
  function run(create) {
    const tree=create({capacity:5}),result=[];
    const root={id:"a",label:"A",status:"running"};tree.upsert(root);root.label="mutated";
    tree.upsert({id:"b",parentId:"a",label:"B",status:"pending"});tree.upsert({id:"c",parentId:"b",label:"C",status:"success"});tree.upsert({id:"d",label:"D",status:"error"});
    result.push(tree.rows(0,20));const snapshot=tree.rows(0,20);snapshot[0].label="changed";result.push(tree.rows(0,20));
    tree.toggle("a");result.push(tree.rows(0,20));tree.toggle("a");tree.upsert({id:"b",parentId:"d",label:"Moved",status:"running"});result.push(tree.rows(0,20));
    for(const offset of [-1,0,0.5,1,3,10,NaN,Infinity])for(const height of [-1,0,0.5,1,3,10,NaN,Infinity])result.push(tree.rows(offset,height));
    result.push(outcome(()=>tree.upsert({id:"d",parentId:"c",label:"cycle",status:"pending"})));result.push(tree.rows(0,20));
    tree.remove("d");tree.remove("missing");result.push(tree.rows(0,20));
    tree.upsert({id:"orphan",parentId:"later",label:"Orphan",status:"pending"});result.push(tree.rows(0,20));
    tree.upsert({id:"later",label:"Parent",status:"success"});result.push(tree.rows(0,20));
    return result;
  }
  assert.deepEqual(run(native.createTaskTree),run(reference.createTaskTree));
});

test("task validation retains error types, capacity and cycle checks",()=>{
  for(const capacity of [0,-1,1.5,NaN,Infinity,"2"])assert.deepEqual(outcome(()=>native.createTaskTree({capacity})),outcome(()=>reference.createTaskTree({capacity})));
  function run(create){const tree=create({capacity:1});tree.upsert({id:"a",label:"a",status:"pending"});return [outcome(()=>tree.upsert({id:"b",parentId:"b",label:"b",status:"pending"})),outcome(()=>tree.upsert({id:"a",parentId:"a",label:"a",status:"pending"})),tree.rows(0,10)];}
  assert.deepEqual(run(native.createTaskTree),run(reference.createTaskTree));
});

test("task row renderers preserve markers, clipping, sanitation and durations",()=>{
  assert.equal(typeof native.renderTaskRows,"function");
  for(const width of [-1,0,0.5,1,8,40,NaN,Infinity])for(const durationMs of [undefined,-1,0,0.5,20,NaN,Infinity]) {
    const rows=[{id:"a",label:"界 e\u0301 👩‍💻",status:"pending",depth:0,collapsed:false,durationMs},{id:"b",label:"First\nSecond\x1b[2J",status:"running",depth:1,collapsed:true,durationMs},{id:"c",label:"done",status:"success",depth:2,collapsed:false,durationMs},{id:"d",label:"failed",status:"error",depth:-1,collapsed:false,durationMs}];
    assert.deepEqual(outcome(()=>native.renderTaskRows(rows,width)),outcome(()=>reference.renderTaskRows(rows,width)));
  }
  for(const status of ["unknown","toString","__proto__",Symbol("status")])assert.deepEqual(outcome(()=>native.renderTaskRows([{label:"x",depth:0,status}],20)),outcome(()=>reference.renderTaskRows([{label:"x",depth:0,status}],20)));
});

test("task upsert preserves property reads, spreads, Map method capture and arbitrary throws",()=>{
  function run(create) {
    const tree=create(),trace=[],node=new Proxy({id:"a",label:"hello",status:"pending"},{ownKeys(target){trace.push("keys");return Reflect.ownKeys(target);},getOwnPropertyDescriptor(target,key){trace.push(`descriptor:${key}`);return Reflect.getOwnPropertyDescriptor(target,key);},get(target,key){trace.push(`get:${key}`);return target[key];}});
    tree.upsert(node);tree.upsert(node);return [tree.rows(0,10),trace];
  }
  assert.deepEqual(run(native.createTaskTree),run(reference.createTaskTree));
  const tree=native.createTaskTree(),thrown={};assert.throws(()=>tree.upsert({get id(){throw thrown;}}),error=>error===thrown);
});

test("task traversal preserves coercion order and leaves explicit iterators open",()=>{
  function run(create) {
    const tree=create(),trace=[],values=Set.prototype.values;
    tree.upsert({id:"a",label:"a",status:"pending"});tree.upsert({id:"b",parentId:"a",label:"b",status:"pending"});tree.upsert({id:"c",label:"c",status:"pending"});
    Set.prototype.values=function(){const iterator=values.call(this);return {next(){trace.push("next");return iterator.next();},return(){trace.push("closed");return {};}};};
    try{return [tree.rows({valueOf(){trace.push("offset");return 0;}},{valueOf(){trace.push("height");return 1;}}),trace];}finally{Set.prototype.values=values;}
  }
  assert.deepEqual(run(native.createTaskTree),run(reference.createTaskTree));
});

test("task rendering preserves getter order, array species and repeated numeric calls",()=>{
  function run(render) {
    const trace=[],row=new Proxy({label:"hello",status:"running",depth:1,durationMs:2.5,collapsed:false},{get(target,key){trace.push(key);return target[key];}});
    class Rows extends Array{static get [Symbol.species](){trace.push("species");return Array;}}
    const rows=new Rows(2);rows[1]=row;
    const width={valueOf(){trace.push("width");return 40;}};
    return [render(rows,width),trace];
  }
  assert.deepEqual(run(native.renderTaskRows),run(reference.renderTaskRows));
});

test("task tree subpaths, method descriptors and detached operations match",async()=>{
  const module=await import("toolcraft-design-rust/task-tree");assert.deepEqual(Object.keys(module),Object.keys(reference));
  for(const key of Object.keys(module)){assert.equal(module[key],native[key]);assert.equal(module[key].name,reference[key].name);assert.equal(module[key].length,reference[key].length);}
  const a=native.createTaskTree(),b=reference.createTaskTree();assert.deepEqual(Object.keys(a),Object.keys(b));
  for(const key of Object.keys(a)){
    const left=Object.getOwnPropertyDescriptor(a,key),right=Object.getOwnPropertyDescriptor(b,key);assert.deepEqual({...left,value:null},{...right,value:null});assert.equal(a[key].name,b[key].name);assert.equal(a[key].length,b[key].length);assert.equal(Object.hasOwn(a[key],"prototype"),Object.hasOwn(b[key],"prototype"));
  }
  const upsert=a.upsert,rows=a.rows;upsert({id:"a",label:"a",status:"pending"});assert.equal(rows(0,1)[0].id,"a");
});

test("task inherited markers coerce before reading labels",()=>{
  function run(render) {
    const trace=[],key="taskMarkerProbe";Object.defineProperty(Object.prototype,key,{configurable:true,value:{toString(){trace.push("marker");return "M";}}});
    try{return [render([{status:key,depth:0,get label(){trace.push("label");return "hello";}}],30),trace];}finally{delete Object.prototype[key];}
  }
  assert.deepEqual(run(native.renderTaskRows),run(reference.renderTaskRows));
});

test("task mutations preserve reentrant snapshots and store-method capture",()=>{
  function run(create) {
    const tree=create(),trace=[],set=Map.prototype.set;
    tree.upsert({id:"root",label:"root",status:"running"});
    Map.prototype.set=function(...args){trace.push("captured");return set.apply(this,args);};
    const node={id:"child",parentId:"root",get label(){trace.push(tree.rows(0,10).map(row=>row.id));Map.prototype.set=function(...args){trace.push("replaced");return set.apply(this,args);};return "child";},status:"pending"};
    try{tree.upsert(node);return [tree.rows(0,10),trace];}finally{Map.prototype.set=set;}
  }
  assert.deepEqual(run(native.createTaskTree),run(reference.createTaskTree));
});

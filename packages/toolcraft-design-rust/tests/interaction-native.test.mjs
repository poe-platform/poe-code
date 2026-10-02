import assert from "node:assert/strict";
import {test} from "node:test";
import * as native from "../dist/index.js";
import {createCommandRegistry} from "../../toolcraft-design/dist/command-registry.js";
import {createOverlayManager} from "../../toolcraft-design/dist/overlay-manager.js";
import {createViewport,selectViewportTail} from "../../toolcraft-design/dist/viewport.js";

const outcome=fn=>{try{return {value:fn()};}catch(error){return {error:[error?.constructor?.name,error?.message]};}};

test("interaction subpaths share the root functions and method descriptors",async()=>{
  for(const [path,names] of [["command-registry",["createCommandRegistry"]],["overlay-manager",["createOverlayManager"]],["viewport",["createViewport","selectViewportTail"]]]) {
    const module=await import(`toolcraft-design-rust/${path}`);
    assert.deepEqual(Object.keys(module),names);
    for(const name of names)assert.equal(module[name],native[name]);
  }
  for(const [name,reference,args] of [["createCommandRegistry",createCommandRegistry,[[]]],["createOverlayManager",createOverlayManager,["root"]],["createViewport",createViewport,[{capacity:2}]]]) {
    const own=native[name](...args),original=reference(...args);
    assert.deepEqual(Reflect.ownKeys(own),Reflect.ownKeys(original));
    for(const key of Object.keys(original)) {
      const a=Object.getOwnPropertyDescriptor(own,key),b=Object.getOwnPropertyDescriptor(original,key);
      assert.deepEqual({...a,value:[a.value.name,a.value.length]},{...b,value:[b.value.name,b.value.length]});
    }
  }
});

test("interaction exports preserve command objects, live enablement and duplicate diagnostics",()=>{
  assert.equal(typeof native.createCommandRegistry,"function");
  function run(create) {
    const trace=[];let enabled=true;
    const command={id:"go",label:"Go",keys:["g"],enabled(){trace.push(["enabled",this===command]);return enabled;},run(){trace.push(["run",this===command]);}};
    const commands=[command],registry=create(commands);
    assert.equal(registry.list()[0],command);
    const result=[registry.dispatch("g")];enabled=false;
    result.push(registry.dispatch("g"),registry.dispatch("missing"),registry.list());
    enabled=true;commands.push({id:"late",label:"Late",keys:["l"],run(){}});
    result.push(registry.list().map(x=>x.id),registry.dispatch("l"));
    return [result,trace];
  }
  assert.deepEqual(run(native.createCommandRegistry),run(createCommandRegistry));
  for(const commands of [
    [{id:"a",keys:[]},{id:"a",keys:[]}],
    [{id:"a",keys:["x"]},{id:"b",keys:["x"]}],
    [{id:"a",keys:["x","x"]}],
    Array(1),null
  ]) assert.deepEqual(outcome(()=>native.createCommandRegistry(commands)),outcome(()=>createCommandRegistry(commands)));
});

test("command registration preserves getter order and closes both iterators on a duplicate",()=>{
  function run(create) {
    const trace=[];
    const command={get id(){trace.push("id");return "id";},get keys(){trace.push("keys");return (function*(){try{yield "x";yield "x";}finally{trace.push("keys closed");}})();}};
    const commands=(function*(){try{yield command;}finally{trace.push("commands closed");}})();
    return [outcome(()=>create(commands)),trace];
  }
  assert.deepEqual(run(native.createCommandRegistry),run(createCommandRegistry));
  const thrown={};
  const registry=native.createCommandRegistry([{id:"x",keys:["x"],enabled(){throw thrown;}}]);
  assert.throws(()=>registry.dispatch("x"),error=>error===thrown);
});

test("overlay cancellation retains reentrant focus and signal identity",()=>{
  assert.equal(typeof native.createOverlayManager,"function");
  function run(create) {
    const trace=[],manager=create("root"),first=manager.open("first");
    first.addEventListener("abort",()=>{trace.push(manager.focus());manager.open("replacement");});
    const second=manager.open("second");
    second.addEventListener("abort",()=>trace.push(manager.focus()));
    trace.push(manager.close(),second.aborted,first.aborted,manager.focus());
    manager.dispose();trace.push(manager.focus(),first.aborted,manager.close());
    const next=manager.open(null);trace.push(manager.focus());manager.close();
    assert.equal(next.aborted,true);
    return trace;
  }
  assert.deepEqual(run(native.createOverlayManager),run(createOverlayManager));
});

test("viewport snapshots retain aliases, order, capacity, offsets and reentrant predicates",()=>{
  assert.equal(typeof native.createViewport,"function");
  function run(create) {
    const a={id:"a",value:1},viewport=create({capacity:2});
    viewport.append(a);viewport.append({id:"b",value:2});viewport.scroll(1.9);
    const held=viewport.items();assert.equal(held[0],a);assert.equal(viewport.items(),held);
    a.value=3;viewport.append({id:"a",value:4});viewport.append({id:"c",value:5});
    const result=[held.map(x=>x.value),viewport.offset(),viewport.unseen()];
    result.push(viewport.find(item=>{viewport.follow();return item.id==="b";}));
    result.push(viewport.items().map(x=>x.id),viewport.offset(),viewport.unseen());
    viewport.scroll(Infinity);viewport.scroll(-Infinity);
    result.push(viewport.offset(),viewport.unseen());
    return result;
  }
  assert.deepEqual(run(native.createViewport),run(createViewport));
  for(const capacity of [0,-1,1.5,NaN,Infinity,"2",null,undefined]) assert.deepEqual(outcome(()=>native.createViewport({capacity})),outcome(()=>createViewport({capacity})));
});

test("tail selection preserves bounded traversal, wrapped rows and coercion order",()=>{
  assert.equal(typeof native.selectViewportTail,"function");
  for(const height of [0,1,2.5,10,NaN,Infinity])for(const offset of [-1,0,1,4,99,NaN,Infinity]) {
    function run(select) {
      const trace=[];
      const result=select([1,2,3],height,offset,value=>{trace.push(value);return value===2?[]:[value,`${value}!`];});
      return [result,trace];
    }
    assert.deepEqual(run(native.selectViewportTail),run(selectViewportTail));
  }
  function run(select) {
    const trace=[],height={valueOf(){trace.push("height");return 2;}},offset={valueOf(){trace.push("offset");return 1;}};
    const items=new Proxy(["a","b","c"],{get(target,key){trace.push(`items.${String(key)}`);return target[key];}});
    return [select(items,height,offset,item=>new Proxy([item,item+item],{get(target,key){trace.push(`rows.${String(key)}`);return target[key];}})),trace];
  }
  assert.deepEqual(run(native.selectViewportTail),run(selectViewportTail));
});

test("interaction callbacks preserve species, reentrancy and arbitrary thrown values",()=>{
  function registryRun(create) {
    const trace=[];
    class Commands extends Array {static get [Symbol.species](){trace.push("species");return Array;}}
    const commands=new Commands(2);let registry;
    commands[1]={id:"x",keys:["x"],enabled(){trace.push("enabled");return 0;},run(){trace.push(registry.dispatch("unknown"));}};
    // The constructor iterates holes, so use a dense list then introduce a hole.
    commands[0]={id:"y",keys:[],run(){}};
    registry=create(commands);delete commands[0];
    return [registry.list().map(x=>x.id),registry.dispatch("x"),trace];
  }
  assert.deepEqual(registryRun(native.createCommandRegistry),registryRun(createCommandRegistry));
  function viewportRun(create) {
    const viewport=create({capacity:1}),original=Array.from,trace=[];
    viewport.append({id:"a"});
    Array.from=function(...args){trace.push(viewport.offset());viewport.follow();return original(...args);};
    try {viewport.scroll(1);return [trace,viewport.offset(),viewport.unseen()];}
    finally {Array.from=original;}
  }
  assert.deepEqual(viewportRun(native.createViewport),viewportRun(createViewport));
  const thrown={token:true};
  assert.throws(()=>native.selectViewportTail([1],1,0,()=>{throw thrown;}),error=>error===thrown);
  const manager=native.createOverlayManager("root"),original=globalThis.AbortController;
  globalThis.AbortController=class {constructor(){throw thrown;}};
  try {assert.throws(()=>manager.open("overlay"),error=>error===thrown);}
  finally {globalThis.AbortController=original;}
});

test("command duplicate checks preserve host collection truthiness",()=>{
  for(const prototype of [Map.prototype,Set.prototype]) {
    const has=prototype.has;
    prototype.has=()=>1;
    let original,own;
    try {
      const commands=[{id:"x",label:"X",keys:["x"],run(){}}];
      original=outcome(()=>createCommandRegistry(commands));
      own=outcome(()=>native.createCommandRegistry(commands));
    } finally {prototype.has=has;}
    assert.deepEqual(own,original);
  }
});

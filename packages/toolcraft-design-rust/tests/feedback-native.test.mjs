import assert from "node:assert/strict";
import {test} from "node:test";
import * as native from "../dist/index.js";
import {createNotices,renderNotice} from "../../toolcraft-design/dist/inline-notice.js";
import {createMetric} from "../../toolcraft-design/dist/metric.js";
import {renderProgressGroup} from "../../toolcraft-design/dist/progress-group.js";
const outcome=fn=>{try{return {value:fn()};}catch(error){return {error:[error?.constructor?.name,error?.message]};}};

test("feedback renderers preserve status marks, clipping, control cleanup and missing progress",()=>{
  assert.equal(typeof native.renderNotice,"function");
  assert.equal(typeof native.renderProgressGroup,"function");
  for(const width of [-1,0,0.5,1,8,24,NaN,Infinity])for(const text of ["","Wait","First\nSecond\x1b[2J","界 e\u0301 👩‍💻\ud800"]) {
    for(const level of ["info","success","warning","error","unknown","toString",Symbol("level")])assert.deepEqual(outcome(()=>native.renderNotice({level,text},width)),outcome(()=>renderNotice({level,text},width)));
    const items=[{label:text},{label:text,completed:2,total:4,status:"success"},{label:text,completed:-1,total:4,status:"error"},{label:text,completed:5,total:4},{label:text,completed:NaN,total:4},{label:text,completed:1,total:Infinity}];
    assert.deepEqual(native.renderProgressGroup(items,width),renderProgressGroup(items,width));
  }
});

test("progress getters retain short-circuit ordering and array species",()=>{
  function run(fn) {
    const trace=[];let statusReads=0;
    const item=new Proxy({label:"Read",completed:2,total:4},{get(target,key){trace.push(key);return key==="status"?++statusReads===1?"running":"error":target[key];}});
    class Items extends Array {static get [Symbol.species](){trace.push("species");return Array;}}
    const items=new Items(2);items[1]=item;
    return [fn(items,20),trace];
  }
  assert.deepEqual(run(native.renderProgressGroup),run(renderProgressGroup));
  const thrown={};
  assert.throws(()=>native.renderProgressGroup([{get total(){throw thrown;}}],20),error=>error===thrown);
});

test("notices preserve key order, coalescing, expiration, bounded text and snapshot isolation",()=>{
  assert.equal(typeof native.createNotices,"function");
  function run(create) {
    let time=0;const notices=create({capacity:2,now:()=>time}),input={level:"info",text:"one",extra:1};
    notices.put("a",input,10);input.text="changed";
    notices.put("b",{level:"error",text:"b"});notices.put("a",{level:"success",text:"replacement"},5);
    const first=notices.list();first[0].text="mutated snapshot";
    const result=[notices.list()];time=5;result.push(notices.list());
    notices.put("c",{level:"warning",text:"c"},-1);result.push(notices.list());
    notices.put("d",{level:"info",text:"d"});notices.put("e",{level:"info",text:"e"});result.push(notices.list());
    notices.dismiss("d");result.push(notices.list());
    notices.put("large",{level:"info",text:"x".repeat(20000)});result.push(notices.list().map(x=>x.text.length));
    return result;
  }
  assert.deepEqual(run(native.createNotices),run(createNotices));
  for(const capacity of [0,-1,1.5,NaN,Infinity,"2"])assert.deepEqual(outcome(()=>native.createNotices({capacity})),outcome(()=>createNotices({capacity})));
});

test("notice publication preserves spread/read/clock order and reentrancy",()=>{
  function run(create) {
    const trace=[];let calls=0;let notices;
    const now=function(){trace.push(["now",this===undefined]);if(++calls===1)notices.dismiss("old");return 1;};
    notices=create({capacity:2,now});
    const notice=new Proxy({level:"info",text:"hello"},{ownKeys(target){trace.push("keys");return Reflect.ownKeys(target);},getOwnPropertyDescriptor(target,key){trace.push(`descriptor:${key}`);return Reflect.getOwnPropertyDescriptor(target,key);},get(target,key){trace.push(`get:${key}`);return target[key];}});
    const duration={valueOf(){trace.push("duration");return 2;}};
    notices.put("x",notice,duration);
    return [notices.list(),trace];
  }
  assert.deepEqual(run(native.createNotices),run(createNotices));
  const thrown={},notices=native.createNotices({capacity:1,now(){throw thrown;}});
  assert.throws(()=>notices.put("x",{level:"info",text:"x"}),error=>error===thrown);
});

test("metrics preserve bounded samples, missing values and fractional rendering widths",()=>{
  assert.equal(typeof native.createMetric,"function");
  for(const capacity of [1,3]) {
    const a=native.createMetric({capacity,unit:"ms"}),b=createMetric({capacity,unit:"ms"});
    for(const value of [null,0,1,4,NaN,Infinity,-2,-0,undefined,"2",3]) {
      a.push(value);b.push(value);assert.deepEqual(a.samples(),b.samples());
      for(const width of [-1,0,0.5,3.5,8,30,NaN,Infinity])assert.deepEqual(outcome(()=>a.render(width)),outcome(()=>b.render(width)),`${capacity}/${value}/${width}`);
    }
  }
  for(const capacity of [0,-1,1.5,NaN,Infinity,"2"])assert.deepEqual(outcome(()=>native.createMetric({capacity,unit:"ms"})),outcome(()=>createMetric({capacity,unit:"ms"})));
});

test("metric width coercions and Math callbacks retain evaluation order",()=>{
  function run(create) {
    const trace=[],metric=create({capacity:3,unit:{toString(){trace.push("unit");return "ms";}}});
    [1,null,4].forEach(value=>metric.push(value));
    const width={valueOf(){trace.push("width");return 12;}};
    const min=Math.min,max=Math.max,round=Math.round;
    Math.min=(...args)=>{trace.push(["min",...args.map(value=>value===width?"width":value)]);return min(...args);};
    Math.max=(...args)=>{trace.push(["max",...args.map(value=>value===width?"width":value)]);return max(...args);};
    Math.round=value=>{trace.push(["round",value]);return round(value);};
    try{return [metric.render(width),trace];}finally{Math.min=min;Math.max=max;Math.round=round;}
  }
  assert.deepEqual(run(native.createMetric),run(createMetric));
});

test("feedback subpaths share root functions and preserve method descriptors",async()=>{
  for(const [path,reference] of [["inline-notice",{createNotices,renderNotice}],["metric",{createMetric}],["progress-group",{renderProgressGroup}]]) {
    const module=await import(`toolcraft-design-rust/${path}`);
    assert.deepEqual(Object.keys(module),Object.keys(reference).sort());
    for(const key of Object.keys(module)) {
      assert.equal(module[key],native[key]);
      assert.equal(module[key].name,reference[key].name);
      assert.equal(module[key].length,reference[key].length);
    }
  }
  for(const [a,b] of [[native.createNotices,createNotices],[native.createMetric,createMetric]]) {
    const left=a({capacity:2,unit:"ms"}),right=b({capacity:2,unit:"ms"});
    assert.deepEqual(Object.keys(left),Object.keys(right));
    for(const key of Object.keys(left)) {
      const own=Object.getOwnPropertyDescriptor(left,key),reference=Object.getOwnPropertyDescriptor(right,key);
      assert.deepEqual({...own,value:null},{...reference,value:null});
      assert.equal(own.value.name,reference.value.name);
      assert.equal(own.value.length,reference.value.length);
      assert.equal(Object.hasOwn(own.value,"prototype"),Object.hasOwn(reference.value,"prototype"));
    }
  }
});

test("metric finite checks and notice setters retain reentrant evaluation order",()=>{
  function metricRun(create) {
    const metric=create({capacity:3,unit:"ms"}),finite=Number.isFinite;
    let nested=false;
    Number.isFinite=value=>{if(!nested){nested=true;metric.push(9);}return finite(value);};
    try{metric.push(2);return metric.samples();}finally{Number.isFinite=finite;}
  }
  assert.deepEqual(metricRun(native.createMetric),metricRun(createMetric));
  function noticeRun(create) {
    const notices=create({capacity:2,now:()=>1}),set=Map.prototype.set,trace=[];
    Map.prototype.set=function(...args){trace.push("captured");return set.apply(this,args);};
    const notice={get level(){Map.prototype.set=function(...args){trace.push("replaced");return set.apply(this,args);};return "info";},text:"value"};
    try{notices.put("x",notice);return [notices.list(),trace];}finally{Map.prototype.set=set;}
  }
  assert.deepEqual(noticeRun(native.createNotices),noticeRun(createNotices));
});

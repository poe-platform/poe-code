import assert from "node:assert/strict";
import {test} from "node:test";
import * as original from "../../toolcraft-design/dist/dashboard/demo.js";

function scenario(api,randomValue,reentrant=false){
  const trace=[],timers=[];let nested=false;
  const dashboard={
    get appendOutput(){trace.push("append getter");return function(value){assert.equal(this,dashboard);trace.push(["output",value]);if(reentrant&&!nested){nested=true;timers[0].fn();timers[1].fn();}};},
    get updateStats(){trace.push("stats getter");return function(value){assert.equal(this,dashboard);trace.push(["stats",value]);};}
  };
  const runtime=new Proxy({
    setInterval(fn,ms){assert.equal(this,undefined);const timer={id:timers.length,fn};timers.push(timer);trace.push(["interval",ms,fn.name,fn.length]);return timer;},
    setTimeout(fn,ms){assert.equal(this,undefined);const timer={id:timers.length,fn};timers.push(timer);trace.push(["timeout",ms,fn.name,fn.length]);return timer;},
    clearInterval(timer){assert.equal(this,undefined);trace.push(["clear interval",timer.id]);},
    clearTimeout(timer){assert.equal(this,undefined);trace.push(["clear timeout",timer.id]);},
    random(){assert.equal(this,undefined);trace.push("random");return randomValue;},
    now(){assert.equal(this,undefined);trace.push("now");return 1234;}
  },{get(target,key,receiver){trace.push(["runtime",key]);return Reflect.get(target,key,receiver);}});
  const cleanup=api.startDashboardDemo(dashboard,runtime);
  trace.push(["cleanup metadata",cleanup.name,cleanup.length]);
  for(let i=0;i<7;i++){timers[0].fn();timers[1].fn();}
  timers[2].fn();cleanup();cleanup();
  timers[0].fn();timers[2].fn();
  return trace;
}

test("dashboard demo exposes the original public functions and lifecycle traces",async()=>{
  const native=await import("toolcraft-design-rust/dashboard/demo");
  assert.deepEqual(Object.keys(native),Object.keys(original));
  for(const key of Object.keys(original)){
    assert.equal(native[key].name,original[key].name);assert.equal(native[key].length,original[key].length);
  }
  for(const random of [-Infinity,-1,0,0.34,0.8,1,Infinity,NaN])assert.deepEqual(scenario(native,random),scenario(original,random));
  assert.deepEqual(scenario(native,0,true),scenario(original,0,true));
});

test("dashboard demo preserves live random coercion, arithmetic methods and message array indexing",async()=>{
  const native=await import("toolcraft-design-rust/dashboard/demo");
  function run(api,index){
    const saved={min:Object.getOwnPropertyDescriptor(Math,"min"),max:Object.getOwnPropertyDescriptor(Math,"max"),floor:Object.getOwnPropertyDescriptor(Math,"floor")},events=[];
    for(const key of Object.keys(saved))Object.defineProperty(Math,key,{configurable:true,get(){events.push(["math",key]);return function(...args){events.push(["call",key,this===Math]);return key==="floor"&&index!==undefined?index:Reflect.apply(saved[key].value,this,args);};}});
    const random={valueOf(){events.push("random coercion");return 0.5;}};
    try{return {trace:scenario(api,random),events};}finally{for(const key of Object.keys(saved))Object.defineProperty(Math,key,saved[key]);}
  }
  for(const index of [undefined,"length","__proto__","missing"])assert.deepEqual(run(native,index),run(original,index));
});

test("dashboard demo preserves immediate timer initialization errors and callback failures",async()=>{
  const native=await import("toolcraft-design-rust/dashboard/demo");
  function immediate(api){
    const trace=[];
    try{api.startDashboardDemo({appendOutput(){},updateStats(value){trace.push(value);}},{setInterval(){return 1;},setTimeout(fn){fn();return 2;},clearInterval(){trace.push("clear interval");},clearTimeout(){trace.push("clear timeout");}});}
    catch(error){trace.push([error.constructor.name,error.message]);}
    return trace;
  }
  assert.deepEqual(immediate(native),immediate(original));
  const failure={failed:true};
  for(const api of [native,original]){
    assert.throws(()=>api.startDashboardDemo({updateStats(){throw failure;}},{}),error=>error===failure);
    const callbacks=[];
    const cleanup=api.startDashboardDemo({updateStats(){},appendOutput(){throw failure;}},{setInterval(fn){callbacks.push(fn);return 1;},setTimeout(){return 2;},clearInterval(){},clearTimeout(){},random:()=>0,now:()=>0});
    assert.throws(()=>callbacks[0](),error=>error===failure);cleanup();
  }
});

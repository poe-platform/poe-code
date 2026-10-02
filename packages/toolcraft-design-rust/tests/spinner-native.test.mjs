import assert from "node:assert/strict";
import {test} from "node:test";
import {spinner as original} from "../../toolcraft-design/dist/prompts/primitives/spinner.js";
import {withOutputFormat as originalFormat} from "../../toolcraft-design/dist/internal/output-format.js";
import {withOutputFormat} from "../dist/logging.js";
const load=async()=>(await import("toolcraft-design-rust/spinner")).spinner;
function run(factory,scope,{format="terminal",tty=true,noSpinner,zeroTimer=false},action){
  const trace=[],timers=new Map(),savedInterval=globalThis.setInterval,savedClear=globalThis.clearInterval,savedWrite=Object.getOwnPropertyDescriptor(process.stdout,"write"),savedTty=Object.getOwnPropertyDescriptor(process.stdout,"isTTY"),savedEnv=process.env.POE_NO_SPINNER;
  let next=zeroTimer?0:1;
  globalThis.setInterval=(callback,delay)=>{const id=next++;trace.push(["interval",id,delay]);timers.set(id,callback);return id;};
  globalThis.clearInterval=id=>{trace.push(["clear",id]);timers.delete(id);};
  Object.defineProperty(process.stdout,"isTTY",{configurable:true,get(){trace.push("tty");return tty;}});
  Object.defineProperty(process.stdout,"write",{configurable:true,get(){trace.push("writer");return function(chunk){trace.push(["write",this===process.stdout,chunk]);return true;};}});
  if(noSpinner===undefined)delete process.env.POE_NO_SPINNER;else process.env.POE_NO_SPINNER=noSpinner;
  try{const spinner=scope(format,factory);trace.push(Object.entries(spinner).map(([name,fn])=>[name,fn.name,fn.length]));action(spinner,trace,timers);trace.push(["remaining timers",[...timers.keys()]]);}
  catch(error){trace.push([error.name,error.message]);}
  finally{globalThis.setInterval=savedInterval;globalThis.clearInterval=savedClear;for(const [name,descriptor]of [["write",savedWrite],["isTTY",savedTty]]){if(descriptor)Object.defineProperty(process.stdout,name,descriptor);else delete process.stdout[name];}if(savedEnv===undefined)delete process.env.POE_NO_SPINNER;else process.env.POE_NO_SPINNER=savedEnv;}
  return trace;
}

test("spinner matches lifecycle, formats, fallbacks and captured output format",async()=>{
  const spinner=await load();assert.equal(spinner,(await import("../dist/index.js")).spinner);assert.equal(spinner,(await import("toolcraft-design-rust/prompts/primitives/spinner")).spinner);
  assert.equal(spinner.name,original.name);assert.equal(spinner.length,original.length);
  for(const format of ["terminal","markdown","json"]){for(const tty of [true,false,undefined]){for(const noSpinner of [undefined,"1"]){
    const action=(s,trace,timers)=>{s.message("before");s.start("\x1b[31mWorking\x1b[0m");for(let i=0;i<10;i++)for(const tick of timers.values())tick();s.message("updated");s.stop();s.stop("again",1);s.start();s.stop("done",0);};
    assert.deepEqual(run(spinner,withOutputFormat,{format,tty,noSpinner},action),run(original,originalFormat,{format,tty,noSpinner},action));
  }}}
});

test("spinner preserves repeated start, timer truthiness and exit code decisions",async()=>{
  const spinner=await load();
  for(const zeroTimer of [true,false])for(const code of [undefined,null,0,-0,1,"0",false,1n]){
    const action=(s,trace,timers)=>{s.stop("before",code);s.start("first");s.start("second");for(const tick of timers.values())tick();s.stop("stopped",code);for(const tick of timers.values())tick();s.message();};
    assert.deepEqual(run(spinner,withOutputFormat,{zeroTimer},action),run(original,originalFormat,{zeroTimer},action));
  }
});

test("spinner propagates writer and timer failures without inventing cleanup",async()=>{
  const spinner=await load();const failure={};
  for(const operation of ["start","message","stop"]){
    const action=s=>{s.start("ready");const saved=process.stdout.write;Object.defineProperty(process.stdout,"write",{configurable:true,value(){throw failure;}});try{assert.throws(()=>s[operation]("next"),error=>error===failure);}finally{Object.defineProperty(process.stdout,"write",{configurable:true,value:saved});}s.stop("recovered");};
    assert.deepEqual(run(spinner,withOutputFormat,{},action),run(original,originalFormat,{},action));
  }
  const action=(s,trace)=>{globalThis.setInterval=()=>{trace.push("interval throw");throw failure;};assert.throws(()=>s.start("start"),error=>error===failure);s.stop("recovered");};
  assert.deepEqual(run(spinner,withOutputFormat,{},action),run(original,originalFormat,{},action));
});

test("spinner preserves reentrant writer and timer callback ordering",async()=>{
  const spinner=await load();
  for(const format of ["terminal","markdown","json"]){
    for(const operation of ["start","message","stop"]){
      const action=(s,trace)=>{
        s.start("initial");let once=true;
        Object.defineProperty(process.stdout,"write",{configurable:true,get(){trace.push("reentrant writer");if(once){once=false;s.message("inside getter");}return chunk=>{trace.push(["captured",chunk]);return true;};}});
        s[operation]("outside");s.stop("done");
      };
      assert.deepEqual(run(spinner,withOutputFormat,{format},action),run(original,originalFormat,{format},action));
    }
  }
  const action=(s,trace,timers)=>{
    const schedule=globalThis.setInterval;
    globalThis.setInterval=(fn,delay)=>{trace.push("synchronous tick");fn();return schedule(fn,delay);};
    s.start("first");const clear=globalThis.clearInterval;let once=true;
    globalThis.clearInterval=id=>{if(once){once=false;s.start("inside clear");}clear(id);};
    s.stop("stopped");s.message("after clear");for(const tick of timers.values())tick();
  };
  assert.deepEqual(run(spinner,withOutputFormat,{},action),run(original,originalFormat,{},action));
});

import assert from "node:assert/strict";
import {test} from "node:test";
import {EventEmitter} from "node:events";
import {createTerminalDriver as original} from "../../toolcraft-design/dist/terminal/driver.js";
const load=async()=>(await import("toolcraft-design-rust/terminal/driver")).createTerminalDriver;
function streams(trace){class Input extends EventEmitter{setRawMode(value){trace.push(["raw",value]);}resume(){trace.push("resume");}pause(){trace.push("pause");}on(name,fn){trace.push(["input on",name,fn.name]);return super.on(name,fn);}off(name,fn){trace.push(["input off",name,fn.name]);return super.off(name,fn);}}
class Output extends EventEmitter{columns=12.8;rows=3.5;write(value){trace.push(["write",value]);return true;}on(name,fn){trace.push(["output on",name,fn.name]);return super.on(name,fn);}off(name,fn){trace.push(["output off",name,fn.name]);return super.off(name,fn);}}
return {input:new Input(),output:new Output()};}

test("Terminal driver composes parsing, modes, resizing and live listener mutation",async()=>{
 const create=await load();assert.equal(create,(await import("../dist/index.js")).createTerminalDriver);assert.equal(create.name,original.name);assert.equal(create.length,original.length);
 function run(factory){const trace=[],{input,output}=streams(trace);const driver=factory({get input(){trace.push("input getter");return input;},get output(){trace.push("output getter");return output;},get escTimeoutMs(){trace.push("timeout getter");return 5;},get mouse(){trace.push("mouse getter");return false;}});
 const shape=Object.entries(driver).map(([key,value])=>[key,value.name,value.length]);
 let removeSecond;const third=event=>trace.push(["third",event]);driver.onEvent(function(event){assert.equal(this,undefined);trace.push(["first",event]);removeSecond();driver.onEvent(third);});removeSecond=driver.onEvent(event=>trace.push(["second",event]));
 const removeResize=driver.onResize(size=>trace.push(["resize",size]));trace.push(driver.getSize());driver.writeFrame("closed");
 try{driver.start();driver.start();input.emit("data","a\x1b[1;2A");input.emit("data",Buffer.from("\x1b[200~paste\x1b[201~"));output.columns=8;output.emit("resize");removeResize();output.emit("resize");driver.writeFrame("frame");driver.stop();driver.stop();input.emit("data","z");driver.start();driver.stop();}finally{driver.stop();}
 return [shape,trace,input.listenerCount("data"),output.listenerCount("resize")];}
 assert.deepEqual(run(create),run(original));
});
test("Terminal driver preserves dimension normalization and start failure state",async()=>{
 const create=await load();
 for(const value of [undefined,0,-0,-2,1.8,NaN,Infinity,"5",null,1n,{valueOf(){throw new Error("must not coerce");}}]){
  function run(factory){const trace=[],{input,output}=streams(trace);Object.defineProperties(output,{columns:{get(){trace.push("cols");return value;}},rows:{get(){trace.push("rows");return value;}}});const driver=factory({input,output});return [driver.getSize(),trace];}
  assert.deepEqual(run(create),run(original));
 }
 function run(factory){const trace=[],{input,output}=streams(trace),failure={};let once=true;input.setRawMode=value=>{trace.push(["raw",value]);if(once){once=false;throw failure;}};const driver=factory({input,output});try{driver.start();}catch(error){assert.equal(error,failure);}driver.start();driver.stop();try{driver.start();}finally{driver.stop();}return trace;}
 assert.deepEqual(run(create),run(original));
});

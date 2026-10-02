import assert from "node:assert/strict";
import {test} from "node:test";
import * as originalPrompt from "../../toolcraft-design/dist/prompts/interactive/test-helpers.js";
import * as originalDriver from "../../toolcraft-design/dist/explorer/runtime.test-helpers.js";

test("prompt test harness preserves stream shape, options and live captured arrays",async()=>{
  const native=await import("toolcraft-design-rust/prompts/interactive/test-helpers");
  assert.deepEqual(Object.keys(native),Object.keys(originalPrompt));
  async function run(api){
    const trace=[];
    const harness=api.createPromptHarness(new Proxy({tty:false,columns:0,rows:undefined},{get(object,key){trace.push(key);return object[key];}}));
    assert.ok(harness.input instanceof (await import("node:stream")).PassThrough);
    assert.ok(harness.output instanceof (await import("node:stream")).Writable);
    trace.push(Object.keys(harness),Object.getOwnPropertyDescriptor(harness.output,"frames"));
    trace.push([harness.input.isTTY,harness.output.isTTY,harness.output.columns,harness.output.rows]);
    trace.push([harness.getOutput.name,harness.getOutput.length,harness.input.setRawMode.name,harness.input.setRawMode.length]);
    harness.output.write("one");harness.output.write(Buffer.from("界"));
    harness.output.frames.push("manual");harness.input.setRawMode(true);harness.input.setRawMode(false);
    trace.push(harness.getOutput(),[...harness.rawModes]);
    harness.output.frames=[];harness.rawModes=[];
    harness.output.write("two");harness.input.setRawMode(true);
    trace.push(harness.getOutput(),harness.output.frames,harness.rawModes);
    let resolved=false;const pending=api.tick().then(()=>{resolved=true;});
    await Promise.resolve();trace.push(resolved);await pending;trace.push(resolved);
    harness.input.destroy();harness.output.destroy();return trace;
  }
  assert.deepEqual(await run(native),await run(originalPrompt));
  for(const key of Object.keys(originalPrompt)){
    assert.equal(native[key].name,originalPrompt[key].name);assert.equal(native[key].length,originalPrompt[key].length);
  }
});

test("fake terminal driver preserves lifecycle, descriptors and mutable listener iteration",async()=>{
  const native=await import("toolcraft-design-rust/explorer/runtime.test-helpers");
  assert.deepEqual(Object.keys(native),Object.keys(originalDriver));
  function run(api){
    const driver=new api.FakeTerminalDriver(),trace=[];
    trace.push(Object.keys(driver),Object.getOwnPropertyDescriptors(Object.getPrototypeOf(driver)));
    const key={name:"x",ch:"x",ctrl:false,meta:false,shift:true};
    driver.writeFrame("ignored");driver.press(key);driver.start();driver.start();driver.writeFrame("one");
    let unsubscribe;
    driver.onEvent(function(event){assert.equal(this,undefined);trace.push(["first",event]);unsubscribe();driver.onEvent(last);});
    function last(event){trace.push(["last",event]);}
    unsubscribe=driver.onEvent(()=>{throw Error("removed listener ran");});
    driver.press(key);
    const off=driver.onResize(function(size){assert.equal(this,undefined);trace.push(["resize",size]);driver.cols+=1;});
    driver.onResize(size=>trace.push(["second resize",size]));
    driver.resize(80,20);off();driver.resize(40,10);
    trace.push(driver.output,driver.getSize(),driver.destroyed,driver.altScreen,driver.enterAltScreenCount);
    driver.stop();driver.stop();driver.press(key);driver.writeFrame("ignored");
    trace.push(driver.destroyed,driver.startCount,driver.stopCount);
    driver.start();driver.writeFrame("two");trace.push(driver.output,driver.destroyed,driver.startCount);
    return trace.map(value=>value&&typeof value==="object"&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,typeof item==="object"&&item!==null&&("value" in item||"get" in item)?{...item,value:typeof item.value==="function"?[item.value.name,item.value.length]:item.value,get:item.get?[item.get.name,item.get.length]:undefined}:item])):value);
  }
  assert.deepEqual(run(native),run(originalDriver));
});

test("fake terminal driver retains getter order, coercions, reentrancy and thrown identities",async()=>{
  const native=await import("toolcraft-design-rust/explorer/runtime.test-helpers");
  function run(api){
    const driver=new api.FakeTerminalDriver(0,null),trace=[];driver.start();
    const key=new Proxy({name:null,ch:"z",ctrl:1,meta:2,shift:3},{get(value,key){trace.push(key);return value[key];}});
    driver.onEvent(event=>trace.push(event));driver.press(key);
    driver.startCount={valueOf(){trace.push("start count coercion");return 5;}};driver.stop();driver.start();
    driver.started="truthy";driver.writeFrame("test");driver.stop();trace.push(driver.getSize(),driver.startCount,driver.stopCount);
    const failure={failed:true};driver.start();driver.onEvent(()=>{throw failure;});
    assert.throws(()=>driver.press(key),error=>error===failure);
    return trace;
  }
  assert.deepEqual(run(native),run(originalDriver));
});

test("fake terminal driver preserves invalid public fields and abrupt iterator closing",async()=>{
  const native=await import("toolcraft-design-rust/explorer/runtime.test-helpers");
  function run(api){
    const driver=new api.FakeTerminalDriver(),trace=[];
    for(const writes of [null,{}, {join:1,push:2}]){
      driver.writes=writes;driver.start();
      for(const invoke of [()=>driver.output,()=>driver.writeFrame("x")]){
        try{invoke();}catch(error){trace.push([error.name,error.message]);}
      }
    }
    const failure={failed:true},closing={closing:true};
    driver.eventHandlers={ [Symbol.iterator](){return {
      next(){trace.push("next");return {done:false,value:()=>{throw failure;}};},
      return(){trace.push("return");throw closing;}
    };}};
    assert.throws(()=>driver.press({ctrl:false,meta:false,shift:false}),error=>error===failure);
    return trace;
  }
  assert.deepEqual(run(native),run(originalDriver));
});

import assert from "node:assert/strict";
import {test} from "node:test";
import {EventEmitter} from "node:events";
import * as original from "../../toolcraft-design/dist/dashboard/terminal.js";

function streams(trace) {
  class Input extends EventEmitter {
    setRawMode(value){trace.push(["raw",value]);}
    resume(){trace.push("resume");}
    pause(){trace.push("pause");}
    on(name,fn){trace.push(["input on",name,fn.name]);return super.on(name,fn);}
    off(name,fn){trace.push(["input off",name,fn.name]);return super.off(name,fn);}
  }
  class Output extends EventEmitter {
    columns=12.8;rows=3.5;
    write(value){trace.push(["write",value]);return true;}
    on(name,fn){trace.push(["output on",name,fn.name]);return super.on(name,fn);}
    off(name,fn){trace.push(["output off",name,fn.name]);return super.off(name,fn);}
  }
  return {stdin:new Input(),stdout:new Output()};
}

test("legacy terminal preserves modes, sparse flush, independent listeners and teardown",async()=>{
  const native=await import("toolcraft-design-rust/dashboard/terminal");
  assert.deepEqual(Object.keys(native),Object.keys(original));
  function run(api){
    const trace=[],{stdin,stdout}=streams(trace);
    const driver=api.createTerminalDriver({get stdin(){trace.push("stdin");return stdin;},get stdout(){trace.push("stdout");return stdout;}});
    const shape=Object.entries(driver).map(([key,fn])=>[key,fn.name,fn.length]);
    const key=event=>trace.push(["key",event]),resize=()=>trace.push("resize");
    const offKey=driver.onKeypress(key);driver.onKeypress(key);const offResize=driver.onResize(resize);driver.onResize(resize);
    for(const name of ["enterRawMode","enterAltScreen","disableLineWrap","hideCursor"]) {driver[name]();driver[name]();}
    driver.moveTo(-2.4,1.9);driver.write("");driver.write("A");
    driver.flush([{x:0,y:0,cell:{ch:"界",style:{underline:true}}},{x:1,y:0,cell:{ch:"",style:{}}},{x:2,y:0,cell:{ch:"é",style:{}}},{x:4,y:1,cell:{ch:"Z",style:{}}}]);
    stdin.emit("data",Buffer.from("a\x1b[A\r"));stdin.emit("data","\x1b[200~q\n");stdin.emit("data","paste\x1b[201~");
    stdout.emit("resize");offKey();offKey();offResize();offResize();stdout.emit("resize");stdin.emit("data","b");
    trace.push(driver.getSize());driver.destroy();driver.destroy();
    for(const name of ["enterRawMode","exitRawMode","enterAltScreen","exitAltScreen","disableLineWrap","enableLineWrap","hideCursor","showCursor"]) driver[name]();
    driver.onKeypress(key)();driver.onResize(resize)();driver.write("ignored");driver.flush([]);driver.moveTo(1,2);
    trace.push(driver.getSize(),stdin.listenerCount("data"),stdout.listenerCount("resize"));
    return {shape,trace};
  }
  assert.deepEqual(run(native),run(original));
});

test("legacy parseKeypress preserves readline events and control-byte overrides",async()=>{
  const native=await import("toolcraft-design-rust/dashboard/terminal");
  const inputs=[...Array.from({length:128},(_,i)=>Buffer.from([i])),...['','aA','界','👩‍💻','é','\x1ba','\x1bA','\x1b[A','\x1b[5~','\x1b[1;5A','\x1b[H','\x1b[F'].map(s=>Buffer.from(s))];
  for(const bytes of inputs) assert.deepEqual(native.parseKeypress(bytes),original.parseKeypress(bytes),bytes.toString('hex'));
});

test("legacy terminal preserves effect failures, reentry and size getter order",async()=>{
  const native=await import("toolcraft-design-rust/dashboard/terminal");
  function run(api){
    const trace=[],{stdin,stdout}=streams(trace),failure={};let fail=true,driver;
    stdin.setRawMode=enabled=>{trace.push(["raw",enabled]);if(fail){fail=false;throw failure;}};
    let nested=false;stdout.write=value=>{trace.push(["write",value]);if(!nested){nested=true;driver.hideCursor();}};
    driver=api.createTerminalDriver({stdin,stdout});
    assert.throws(()=>driver.enterRawMode(),error=>error===failure);driver.enterRawMode();driver.enterAltScreen();driver.destroy();
    for(const value of [undefined,NaN,Infinity,-2,0,1.9,"5",null,1n]){
      Object.defineProperties(stdout,{columns:{configurable:true,get(){trace.push("cols");return value;}},rows:{configurable:true,get(){trace.push("rows");return value;}}});trace.push(driver.getSize());
    }
    return trace;
  }
  assert.deepEqual(run(native),run(original));
});

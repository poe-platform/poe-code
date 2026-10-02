import assert from "node:assert/strict";
import {test} from "node:test";
import * as original from "../../toolcraft-design/dist/dashboard/components/context-pane.js";
import {ScreenBuffer as OriginalBuffer} from "../../toolcraft-design/dist/dashboard/buffer.js";

test("dashboard context reserves bounded rows and retains untouched rectangle identity",async()=>{
  const native=await import("toolcraft-design-rust/dashboard/components/context-pane");
  assert.deepEqual(Object.keys(native),Object.keys(original));
  const {ScreenBuffer}=await import("toolcraft-design-rust/dashboard/buffer");
  for(const width of [0,1,8,30,48])for(const height of [0,1,2,4,12])for(const context of [[],[""],["Plan 1/1: docs/plans/improve-restart-progress-and-task-counts.md"],["Plan 1/3: 项目 👩‍💻", "Next: second.md", "Next: third.md"],["\x1b[31mPlan\x1b[0m",...Array.from({length:12},(_,i)=>`Next: ${i}.md`)]] ){
    const a=new ScreenBuffer(width+2,height+2),b=new OriginalBuffer(width+2,height+2),rect={x:1,y:1,width,height};
    const result=native.renderContextPane(a,rect,context),expected=original.renderContextPane(b,rect,context);
    assert.equal(result===rect,expected===rect);assert.deepEqual(result,expected);assert.deepEqual({...a},{...b});
  }
});

test("dashboard context preserves array species, getter order, receivers and thrown identity",async()=>{
  const native=await import("toolcraft-design-rust/dashboard/components/context-pane");
  function capture(api){
    const trace=[];
    const rect=new Proxy({x:1,y:2,width:18,height:4},{get(target,key,receiver){trace.push(key);return Reflect.get(target,key,receiver);}});
    class Context extends Array {static get [Symbol.species](){trace.push("species");return Array;}}
    const context=Context.of("Plan: long filename that wraps over several rows", "Next: plan.md");
    const buffer={get clearRect(){trace.push("clear getter");return function(value){assert.equal(this,buffer);trace.push(["clear",{...value}]);};},get putInRect(){trace.push("put getter");return function(value,...args){assert.equal(this,buffer);trace.push([{...value},...args]);};}};
    const result=api.renderContextPane(buffer,rect,context);
    const failure={};assert.throws(()=>api.renderContextPane({clearRect(){throw failure;}},{x:0,y:0,width:20,height:4},["plan"]),error=>error===failure);
    return {trace,result};
  }
  assert.deepEqual(capture(native),capture(original));
});

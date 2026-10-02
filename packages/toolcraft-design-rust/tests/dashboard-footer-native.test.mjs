import assert from "node:assert/strict";
import {test} from "node:test";
import * as original from "../../toolcraft-design/dist/dashboard/components/footer.js";
import {configureTheme as configureOriginal,resetTheme as resetOriginal} from "../../toolcraft-design/dist/internal/theme-state.js";
import {configureTheme,resetTheme} from "../dist/theme-state.js";
import {ScreenBuffer as OriginalBuffer} from "../../toolcraft-design/dist/dashboard/buffer.js";

test("dashboard footer keeps fresh default hints and all complete fitting hints",async()=>{
  const native=await import("toolcraft-design-rust/dashboard/components/footer");
  assert.deepEqual(Object.keys(native),Object.keys(original));
  assert.deepEqual(native.defaultHints(),original.defaultHints());
  const a=native.defaultHints(),b=native.defaultHints();assert.notEqual(a,b);assert.notEqual(a[0],b[0]);a[0].key="x";assert.equal(b[0].key,"q");
  for(const width of [0,1,3,8,12,40])for(const height of [0,1,3])for(const hints of [[],original.defaultHints(),[{key:"👩‍💻",label:"Go"}],[{key:"\x1b[31mQ",label:"Quit\rREPLACED"}]]){
    const capture=api=>{const calls=[];api.renderFooter({clearRect(rect){calls.push(["clear",rect]);},put(...args){calls.push(args);}},{x:1,y:2,width,height},hints);return calls;};
    assert.deepEqual(capture(native),capture(original));
  }
});

test("dashboard footer preserves session rows, Unicode clipping and active themes",async()=>{
  const native=await import("toolcraft-design-rust/dashboard/components/footer");
  const {ScreenBuffer}=await import("toolcraft-design-rust/dashboard/buffer");
  try {
    for(const brand of ["purple","blue","green"]){
      configureTheme({brand});configureOriginal({brand});
      for(const width of [1,12,60])for(const height of [1,2])for(const session of [undefined,{cwd:"/workspace/项目/long/path",agent:"codex"},{cwd:"\x1b[31m/project",agent:"rust",model:"model name"}]){
        const a=new ScreenBuffer(width+2,height),b=new OriginalBuffer(width+2,height),rect={x:1,y:0,width,height};
        const hints=original.defaultHints();native.renderFooter(a,rect,hints,session);original.renderFooter(b,rect,hints,session);assert.deepEqual({...a},{...b});
      }
    }
  } finally {resetTheme();resetOriginal();}
});

test("dashboard footer preserves getter order, array species, callbacks and thrown identity",async()=>{
  const native=await import("toolcraft-design-rust/dashboard/components/footer");
  function capture(api){
    const trace=[];
    const wrap=(tag,value)=>new Proxy(value,{get(target,key,receiver){trace.push([tag,key]);return Reflect.get(target,key,receiver);}});
    const rect=wrap("rect",{x:0,y:0,width:50,height:2}),session=wrap("session",{cwd:"/project",agent:"codex",model:"model"});
    class Hints extends Array {static get [Symbol.species](){trace.push("species");return Array;}}
    const hints=wrap("hints",Hints.of(wrap("hint",{key:"q",label:"Quit"}),{key:"e",label:"Edit"}));
    const buffer={get clearRect(){trace.push("clear getter");return function(value){assert.equal(this,buffer);assert.equal(value,rect);trace.push("clear");};},get put(){trace.push("put getter");return function(...args){assert.equal(this,buffer);trace.push(args);};}};
    api.renderFooter(buffer,rect,hints,session);
    const failure={};assert.throws(()=>api.renderFooter({clearRect(){throw failure;}},rect,hints),error=>error===failure);
    return trace;
  }
  assert.deepEqual(capture(native),capture(original));
});

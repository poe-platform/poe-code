import assert from "node:assert/strict";
import {test} from "node:test";
import * as native from "../dist/index.js";
import * as reference from "../../toolcraft-design/dist/index.js";
const outcome=fn=>{try{return {value:fn()};}catch(error){return {error:[error?.constructor?.name,error?.message]};}};

test("static spinner frames and stopped messages preserve all output formats",()=>{
  assert.equal(typeof native.renderSpinnerFrame,"function");assert.deepEqual(native.SPINNER_FRAMES,reference.SPINNER_FRAMES);assert.equal(Object.isFrozen(native.SPINNER_FRAMES),true);
  for(const format of ["terminal","markdown","json"])for(const frame of [-5,-1,0,1,4,1.5,NaN,Infinity,undefined,null,"2"]) {
    const options={frame,message:"Work\nnext\rline",timer:"2s\nremaining",subtext:"detail",code:frame};
    for(const name of ["renderSpinnerFrame","renderSpinnerStopped"])assert.deepEqual(outcome(()=>native.withOutputFormat(format,()=>native[name](options))),outcome(()=>reference.withOutputFormat(format,()=>reference[name](options))),`${format}/${name}/${frame}`);
  }
});

test("static menus preserve selection validation, hints and formats",()=>{
  assert.equal(typeof native.renderMenu,"function");
  for(const format of ["terminal","markdown","json"])for(const selectedIndex of [-1,0,1,5,NaN,Infinity,1.5,"1",null,undefined]) {
    const options={message:"Pick\nagent",selectedIndex,options:[{label:"First\nrow",value:"a",hint:"recommended"},{label:"Second",value:"b"}]};
    assert.deepEqual(outcome(()=>native.withOutputFormat(format,()=>native.renderMenu(options))),outcome(()=>reference.withOutputFormat(format,()=>reference.renderMenu(options))));
  }
});

test("static renderers retain changing getter order and arbitrary throws",()=>{
  for(const format of ["terminal","markdown","json"])for(const name of ["renderSpinnerFrame","renderSpinnerStopped","renderMenu"]) {
    function run(api) {
      const trace=[],options=new Proxy({message:"message",frame:1,code:1,timer:"1s",subtext:"detail",selectedIndex:1,options:[{label:"one",value:"one",hint:"hint"},{label:"two",value:"two"}]},{get(target,key){trace.push(key);return target[key];}});
      return [outcome(()=>api.withOutputFormat(format,()=>api[name](options))),trace];
    }
    assert.deepEqual(run(native),run(reference),`${format}/${name}`);
  }
  const thrown={};assert.throws(()=>native.renderSpinnerFrame({get frame(){throw thrown;}}),error=>error===thrown);
});

test("static menu mapping preserves sparse arrays, species and custom forEach receivers",()=>{
  function run(api,format) {
    const trace=[];class Options extends Array{static get [Symbol.species](){trace.push("species");return Array;}}
    const options=new Options(2);options[1]={label:"one",value:"one",hint:"hint"};
    options.forEach=function(fn){trace.push(["forEach",this===options]);trace.push(["result",fn(options[1],0)]);};
    return [api.withOutputFormat(format,()=>api.renderMenu({message:"Pick",options})),trace];
  }
  for(const format of ["terminal","markdown","json"])assert.deepEqual(run(native,format),run(reference,format));
});

test("static subpaths and namespaces share public identities and frozen frames",async()=>{
  assert.equal(native.staticRender,await import("toolcraft-design-rust/static/index"));
  for(const path of ["static/index","static/spinner","static/menu","spinner-frames","render-spinner-frame","render-spinner-stopped","render-menu"]){
    const module=await import(`toolcraft-design-rust/${path}`),original=await import(`toolcraft-design/${path}`);assert.deepEqual(Object.keys(module),Object.keys(original));
    for(const key of Object.keys(module)){assert.equal(module[key],native[key]);if(typeof module[key]==="function"){assert.equal(module[key].name,original[key].name);assert.equal(module[key].length,original[key].length);}}
  }
  assert.deepEqual(Object.getOwnPropertyDescriptors(native.SPINNER_FRAMES),Object.getOwnPropertyDescriptors(reference.SPINNER_FRAMES));assert.equal(Reflect.set(native.SPINNER_FRAMES,0,"x"),false);
});

test("static JSON and markdown renderers preserve serialization and coercion order",()=>{
  function run(api,format,name){
    const trace=[],message={toString(){trace.push("message conversion");return "message";},replaceAll(...args){trace.push(["replace",...args]);return "message";},toJSON(){trace.push("message JSON");return "message";}};
    const options={message,get timer(){trace.push("timer");return "1s";},get code(){trace.push("code");return 0;},get subtext(){trace.push("subtext");return "detail";},options:[]};
    return [api.withOutputFormat(format,()=>api[name](options)),trace];
  }
  for(const format of ["terminal","markdown","json"])for(const name of ["renderSpinnerFrame","renderSpinnerStopped","renderMenu"])assert.deepEqual(run(native,format,name),run(reference,format,name));
});

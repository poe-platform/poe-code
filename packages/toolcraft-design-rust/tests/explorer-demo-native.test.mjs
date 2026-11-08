import assert from "node:assert/strict";
import {test} from "node:test";
import * as original from "../../toolcraft-design/dist/explorer/demo.js";
import {createInitialState as originalState} from "../../toolcraft-design/dist/explorer/state.js";
import {createInitialState as nativeState} from "../dist/explorer-state.js";

function outcome(fn){try{return {value:fn()};}catch(error){return {error:[error.name,error.message]};}}
function shape(value){
  if(typeof value==="function")return [value.name,value.length,Object.getPrototypeOf(value).constructor.name];
  if(Array.isArray(value))return value.map(shape);
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,shape(item)]));
  return value;
}

test("explorer demo exposes original names and parses argv/environment with matching observations",async()=>{
  const native=await import("toolcraft-design-rust/explorer/demo");
  assert.deepEqual(Object.keys(native),Object.keys(original));
  for(const key of Object.keys(original))assert.deepEqual(shape(native[key]),shape(original[key]));
  for(const argv of [[],["--mode","list-detail-mode"],["--slow-detail","--single-detail-mode"],["--list-detail-mode","--mode=single-detail-mode"],["--mode"],["--mode=bad"],["--ignored"],[null],[3],[Symbol("x")]]){
    for(const env of [{},{EXPLORER_DEMO_MODE:"list-detail-mode",EXPLORER_DEMO_SLOW_DETAIL:"YES"},{EXPLORER_DEMO_MODE:"bad",EXPLORER_DEMO_SLOW_DETAIL:null}]){
      assert.deepEqual(outcome(()=>native.parseExplorerDemoOptions(argv,env)),outcome(()=>original.parseExplorerDemoOptions(argv,env)));
    }
  }
  function trace(api){
    const events=[];
    const env=new Proxy({EXPLORER_DEMO_MODE:"list-detail-mode",EXPLORER_DEMO_SLOW_DETAIL:{toLowerCase(){events.push("lower");return "yes";}}},{get(target,key){events.push(["env",key]);return target[key];}});
    const arg={startsWith(value){events.push(["starts",value,this===arg]);return true;},slice(value){events.push(["slice",value,this===arg]);return "bad";}};
    const argv=new Proxy([arg],{get(target,key){events.push(["arg",key]);return target[key];}});
    return {result:outcome(()=>api.parseExplorerDemoOptions(argv,env)),events};
  }
  assert.deepEqual(trace(native),trace(original));
});

test("explorer demo initializes with reference accelerators and preserves printable filtering",async()=>{
  const native=await import("toolcraft-design-rust/explorer/demo");
  for(const mode of ["single-detail-mode","list-detail-mode"]){
    const options={mode,slowDetail:false};
    const actual=nativeState(native.buildExplorerDemoConfig(options),{cols:104,rows:22});
    const expected=originalState(original.buildExplorerDemoConfig(options),{cols:104,rows:22});
    assert.deepEqual(actual.bindings.bindings,expected.bindings.bindings);
    assert.deepEqual(actual.bindings.keysByTarget,expected.bindings.keysByTarget);
    for(const [name,id] of [["r","refresh"],["e","archive"],...(mode==="list-detail-mode"?[["x","resolve-comment"]]:[])]){
      assert.deepEqual(actual.bindings.resolve({name,ctrl:true}),{type:"action",id});
      assert.equal(actual.bindings.resolve({name}),undefined);
    }
    assert.deepEqual(actual.bindings.resolve({name:"a",ctrl:true}),{type:"builtin",id:"selectAll"});
  }
});

test("explorer demo config preserves shared rows, detail content, callable metadata and actions",async()=>{
  const native=await import("toolcraft-design-rust/explorer/demo");
  async function run(api,mode){
    const events=[],reorder=ids=>events.push(["reorder",ids]);
    const config=api.buildExplorerDemoConfig({mode,slowDetail:false,onReorder:reorder});
    assert.equal(config.reorder.onReorder,reorder);
    const rows=await config.rows();assert.equal(rows,await api.buildExplorerDemoConfig({mode,slowDetail:false}).rows());
    events.push(shape(config),rows);
    for(const row of [...rows,{id:"missing",title:"Missing"},{id:"toString",title:"Inherited"}]){
      try{
        const items=await config.detail.items(row,{signal:new AbortController().signal});
        events.push(shape(items),await Promise.all(items.map(item=>item.render())));
      }catch(error){events.push([error.name,error.message]);}
    }
    const ctx={row:rows[0],rows:[rows[0]],item:{title:"Comment"},toast(...args){assert.equal(this,ctx);events.push(args);},refresh(){assert.equal(this,ctx);events.push("refresh");return Promise.resolve();}};
    for(const action of [...config.actions,...(config.detail.actions??[])]){
      events.push([action.id,typeof action.label==="function"?action.label():action.label]);
      events.push(["return",await action.handler(ctx)]);
    }
    config.reorder.onReorder(["b","a"]);return events;
  }
  for(const mode of ["single-detail-mode","list-detail-mode","unknown"])assert.deepEqual(await run(native,mode),await run(original,mode));
});

test("explorer demo reads changing configuration and callback properties in reference order",async()=>{
  const native=await import("toolcraft-design-rust/explorer/demo");
  async function run(api){
    const trace=[];let read=0;
    const options={get mode(){trace.push("mode");return read++===0?"single-detail-mode":"list-detail-mode";},get slowDetail(){trace.push("slow");return false;},get onReorder(){trace.push("reorder");return undefined;}};
    const config=api.buildExplorerDemoConfig(options);trace.push(shape(config),(await config.rows())[0].id);
    const row=new Proxy({id:"missing",title:"Hello"},{get(target,key){trace.push(["row",key]);return target[key];}});
    trace.push(shape(await config.detail.items(row,{})));
    let lengths=0;const rows={get length(){trace.push("length");return ++lengths;}};
    const ctx={get toast(){trace.push("toast");return function(...args){trace.push(["emit",this===ctx,args]);};},get rows(){trace.push("rows");return rows;}};
    config.actions[2].handler(ctx);return trace;
  }
  assert.deepEqual(await run(native),await run(original));
});

test("explorer demo preserves callback failures and live interpolation coercions",async()=>{
  const native=await import("toolcraft-design-rust/explorer/demo");
  for(const api of [native,original]){
    for(const failure of [undefined,null,Symbol("failure"),{failed:true}]){
      assert.throws(()=>api.parseExplorerDemoOptions([],{get EXPLORER_DEMO_MODE(){throw failure;}}),error=>error===failure);
      const config=api.buildExplorerDemoConfig({mode:"list-detail-mode",slowDetail:false});
      const ctx={row:{title:"row"},rows:[],toast(){throw failure;},refresh(){throw failure;}};
      assert.throws(()=>config.actions[0].handler(ctx),error=>error===failure);
      await assert.rejects(config.actions[1].handler(ctx),error=>error===failure);
      await assert.rejects(config.detail.items({get id(){throw failure;}},{}),error=>error===failure);
    }
  }
  function trace(api){
    const trace=[],config=api.buildExplorerDemoConfig({mode:"list-detail-mode",slowDetail:false});
    const ctx={toast(message,tone){trace.push([message,tone]);},rows:{get length(){trace.push("length");return {toString(){trace.push("string");ctx.rows={length:1};return "5";}};}}};
    config.actions[2].handler(ctx);
    ctx.toast=null;
    trace.push(outcome(()=>config.actions[0].handler({...ctx,row:{title:"x"}})));
    return trace;
  }
  assert.deepEqual(trace(native),trace(original));
});

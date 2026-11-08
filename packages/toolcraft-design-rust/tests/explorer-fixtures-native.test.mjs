import assert from "node:assert/strict";
import {test} from "node:test";
import * as original from "../../toolcraft-design/dist/explorer/render/test-fixtures.js";
import {ScreenBuffer} from "../../toolcraft-design/dist/dashboard/buffer.js";

function normalize(value){
  if(typeof value==="function")return [value.name,value.length];
  if(value instanceof Map)return ["Map",[...value].map(normalize)];
  if(value instanceof Set)return ["Set",[...value].map(normalize)];
  if(Array.isArray(value))return value.map(normalize);
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,normalize(item)]));
  return value;
}
test("explorer fixtures expose fresh reference data and exact function metadata",async()=>{
  const native=await import("toolcraft-design-rust/explorer/render/test-fixtures");
  assert.deepEqual(Object.keys(native),Object.keys(original));
  for(const key of Object.keys(original))assert.deepEqual(normalize(native[key]),normalize(original[key]));
  for(const key of ["fixtureRows","singleDetailItem","listDetailItems","fixtureState"]){
    assert.deepEqual(normalize(native[key]()),normalize(original[key]()));
    assert.notEqual(native[key](),native[key]());
  }
  assert.equal(native.singleDetailItem().render(),original.singleDetailItem().render());
  assert.deepEqual(native.listDetailItems().map(item=>item.render()),original.listDetailItems().map(item=>item.render()));
  const rows=native.fixtureRows();rows[0].title="changed";assert.notEqual(native.fixtureRows()[0].title,"changed");
});
test("explorer fixture states retain overrides, property reads and rendered output",async()=>{
  const native=await import("toolcraft-design-rust/explorer/render/test-fixtures");
  for(const overrides of [{},{filter:"plan"},{size:{cols:24,rows:7}},{title:"Tasks",cursor:2,selected:new Set(["25"])},{focused:"detail",modal:{kind:"help"}},{rows:[],dirty:0}]){
    const left=native.fixtureState(overrides),right=original.fixtureState(overrides);
    assert.deepEqual(normalize(left),normalize(right));
    assert.equal(native.renderStateSnapshot(left),original.renderStateSnapshot(right));
  }
  function run(api){
    const events=[],rows=api.fixtureRows();
    const overrides=new Proxy({rows,cursor:undefined,title:"X",custom:42},{get(target,key,receiver){events.push(["get",key]);return Reflect.get(target,key,receiver);},ownKeys(target){events.push("keys");return Reflect.ownKeys(target);},getOwnPropertyDescriptor(target,key){events.push(["descriptor",key]);return Reflect.getOwnPropertyDescriptor(target,key);}});
    const state=api.fixtureState(overrides);assert.equal(state.rows,rows);return [normalize(state),events];
  }
  assert.deepEqual(run(native),run(original));
});
test("screen fixture dumping preserves live dimensions, method receivers and errors",async()=>{
  const native=await import("toolcraft-design-rust/explorer/render/test-fixtures");
  function run(api){
    const trace=[],buffer=new ScreenBuffer(4,2);buffer.put(0,0,"界a");buffer.put(0,1,"test");
    const screen={get height(){trace.push("height");return 2;},get width(){trace.push("width");return 4;},get(x,y){assert.equal(this,screen);trace.push(["get",x,y]);return buffer.get(x,y);}};
    return [api.dumpScreen(screen),trace];
  }
  assert.deepEqual(run(native),run(original));
  const failure={failed:true};
  for(const api of [native,original])assert.throws(()=>api.dumpScreen({height:1,width:1,get(){throw failure;}}),error=>error===failure);
});

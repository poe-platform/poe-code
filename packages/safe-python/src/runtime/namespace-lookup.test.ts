import {expect,it} from "vitest";
import {lookupNamespace,storeNamespace,type MutableNameNamespace} from "./namespace-lookup.js";

it.each([false,true])("shares mutable name storage without losing undefined (adapter=%s)",adapter=>{
  const backing=new Map<string,unknown>();
  const namespace:MutableNameNamespace<unknown>=adapter?{
    lookup:name=>backing.has(name)?{value:backing.get(name)}:undefined,
    store:backing.set.bind(backing),delete:backing.delete.bind(backing)
  }:backing;
  expect(lookupNamespace(namespace,"x")).toBeUndefined();
  storeNamespace(namespace,"x",undefined);expect(lookupNamespace(namespace,"x")).toEqual({value:undefined});expect(backing.has("x")).toBe(true);
  backing.set("x",7);expect(lookupNamespace(namespace,"x")).toEqual({value:7});
  expect(namespace.delete("x")).toBe(true);expect(lookupNamespace(namespace,"x")).toBeUndefined();
  storeNamespace(namespace,"K",1);storeNamespace(namespace,"K",2);expect([...backing]).toEqual([["K",1],["K",2]]);
});

it("does not turn adapter failures into missing names or successful writes",()=>{
  const failure=Error("storage failure"),namespace={lookup(){throw failure;},store(){throw failure;},delete(){throw failure;}};
  expect(()=>lookupNamespace(namespace,"x")).toThrow(failure);expect(()=>storeNamespace(namespace,"x",1)).toThrow(failure);
});

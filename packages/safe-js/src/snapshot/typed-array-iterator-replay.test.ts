import { assert, expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";

it("retains a typed array's custom iterator properties through construction and replay", async () => {
  const source=`const items=new Uint8Array([1,2]);const events=[];
    const original=items[Symbol.iterator];
    Object.defineProperty(items,Symbol.iterator,{configurable:true,get(){events.push('get');return original}});
    function C(){events.push('constructor');Object.defineProperty(items,Symbol.iterator,{value:function(){throw 'replacement'}})}
    await 0;const value=Array.from.call(C,items);return [events,value.length,value[0],value[1]];`;
  const expected=await Function('return (async()=>{'+source+'})()')();
  const result=await run(source);
  assert(result.ok);
  expect(result.returnValue).toEqual(expected);
  const resumed=await run(source,{snapshot:JSON.parse(await dump(result))});
  assert(resumed.ok);
  expect(resumed.returnValue).toEqual(expected);
});

it.each(["Float32Array", "Uint8Array", "Float16Array", "BigInt64Array"])("preserves %s symbol descriptors, cycles and shared storage in public replay", async constructor => {
  const element=constructor==="BigInt64Array" ? "7n" : "7";
  const source=`const value=new ${constructor}([${element}]);const alias=new ${constructor}(value.buffer);
    const key=Symbol('metadata');
    Object.defineProperty(value,key,{get(){return value},configurable:true});
    Object.defineProperty(value,'hidden',{value:alias,writable:false});
    Object.preventExtensions(value);
    await 0;
    const descriptor=Object.getOwnPropertyDescriptor(value,'hidden');
    return [value[key]===value,value.hidden===alias,value.buffer===alias.buffer,String(alias[0]),descriptor.enumerable,descriptor.writable,Object.isExtensible(value)];`;
  const result=await run(source);
  assert(result.ok);
  expect(result.returnValue).toEqual([true,true,true,"7",false,false,false]);
  const resumed=await run(source,{snapshot:JSON.parse(await dump(result))});
  assert(resumed.ok);
  expect(resumed.returnValue).toEqual(result.returnValue);
});

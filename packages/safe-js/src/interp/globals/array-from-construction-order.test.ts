import { assert, expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it.each([
  ["reads the method, constructs, then acquires the iterator", `
    const events=[];
    function C(){events.push('constructor')}
    const items={get [Symbol.iterator](){events.push('get');return function(){
      events.push('factory');return {get next(){events.push('next getter');return function(){return {done:true}}}}
    }}};
    Array.from.call(C,items);return events;
  `],
  ["does not invoke a factory after a throwing constructor", `
    const events=[];
    function C(){events.push('constructor');throw 'construction failed'}
    const items={[Symbol.iterator](){events.push('factory');return {next(){return {done:true}}}}};
    try{Array.from.call(C,items)}catch(error){events.push(error)}return events;
  `],
  ["keeps the method captured before constructor mutation", `
    const events=[];
    const items={[Symbol.iterator](){events.push('original');return {next(){return {done:true}}}}};
    function C(){events.push('constructor');items[Symbol.iterator]=function(){events.push('replacement');throw 'wrong method'}}
    Array.from.call(C,items);return events;
  `],
  ["constructs before a throwing iterator factory", `
    const events=[];
    function C(){events.push('constructor')}
    const items={[Symbol.iterator](){events.push('factory');throw 'factory failed'}};
    try{Array.from.call(C,items)}catch(error){events.push(error)}return events;
  `],
  ["validates callable methods before constructing", `
    const events=[];
    function C(){events.push('constructor')}
    const items={get [Symbol.iterator](){events.push('get');return 7}};
    try{Array.from.call(C,items)}catch(error){events.push(error.name)}return events;
  `],
  ["reads array-like length before constructing and elements afterwards", `
    const events=[];
    function C(length){events.push(['constructor',length])}
    const items={get [Symbol.iterator](){events.push('get');return null},get length(){events.push('length');return 1},get 0(){events.push('value');return 9}};
    const result=Array.from.call(C,items);return [events,result[0],result.length];
  `],
  ["does not reacquire an array iterator changed by the constructor", `
    const events=[];const items=[1,2];
    const original=items[Symbol.iterator];
    Object.defineProperty(items,Symbol.iterator,{configurable:true,get(){events.push('get');return original}});
    function C(){events.push('constructor');Object.defineProperty(items,Symbol.iterator,{value:function(){throw 'replacement'}});items.push(3)}
    const result=Array.from.call(C,items);return [events,result[0],result[1],result[2],result.length];
  `],
  ["captures a boxed string iterator before construction", `
    const events=[];const items=new String('ab');
    Object.defineProperty(items,Symbol.iterator,{get(){events.push('get');return function(){events.push('factory');return [1][Symbol.iterator]()}}});
    function C(){events.push('constructor')}
    const result=Array.from.call(C,items);return [events,result[0],result.length];
  `],
  ["captures a primitive string's inherited iterator before construction", `
    const events=[];const original=String.prototype[Symbol.iterator];
    try{
      Object.defineProperty(String.prototype,Symbol.iterator,{configurable:true,get(){events.push('get');return function(){events.push('factory');return ['a','b'][Symbol.iterator]()}}});
      function C(){events.push('constructor')}
      const result=Array.from.call(C,'ab');return [events,result[0],result[1],result.length];
    }finally{Object.defineProperty(String.prototype,Symbol.iterator,{value:original,writable:true,configurable:true})}
  `]
])("Array.from %s", async (_name, source) => {
  const expected=Function("'use strict';"+source)();
  const result=await run(source);
  assert(result.ok);
  expect(result.returnValue).toEqual(expected);
});

it.each(["[1,2]", "new Set([1,2])", "new Map([[1,2]])", "(function*(){yield 1;yield 2})()"])("retains captured iterator identity through construction and replay: %s", async expression => {
  const source=`const items=${expression};const events=[];
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

import { runInNewContext } from "node:vm";
import { assert, expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";

const cases = [
  "return typeof Iterator",
  "return Iterator.prototype === Object.getPrototypeOf(Object.getPrototypeOf([].values()))",
  "const d=Object.getOwnPropertyDescriptor(Iterator,'prototype');return [Iterator.name, Iterator.length,d.writable,d.enumerable,d.configurable]",
  "try { Iterator(); } catch (error) { return error.name; }",
  "try { new Iterator(); } catch (error) { return error.name; }",
  "class Counter extends Iterator { next() { return {value:1,done:false}; } } const it=new Counter(); return [it instanceof Counter,it instanceof Iterator,it[Symbol.iterator]()===it,it.next()]",
  "return [new Map().values() instanceof Iterator,new Set().values() instanceof Iterator,''[Symbol.iterator]() instanceof Iterator,''.matchAll(/./g) instanceof Iterator]",
  "const descriptor=Object.getOwnPropertyDescriptor(Iterator.prototype,'constructor');return [descriptor.get.name,descriptor.get.length,descriptor.set.name,descriptor.set.length,descriptor.enumerable,descriptor.configurable,Iterator.prototype.constructor===Iterator]",
  "const it=[].values();it.constructor=7;return [it.constructor,Object.hasOwn(it,'constructor'),Iterator.prototype.constructor===Iterator]",
  "try {Iterator.prototype.constructor=7;}catch(error){return error.name}",
  "function C(){}C.prototype=null;const it=Reflect.construct(Iterator,[],C);return Object.getPrototypeOf(it)===Iterator.prototype",
  "function C(){}const it=Reflect.construct(Iterator,[],C);return [Object.getPrototypeOf(it)===C.prototype,it instanceof C]",
  "const set=Object.getOwnPropertyDescriptor(Iterator.prototype,'constructor').set;return [null,7,Iterator.prototype,Object.freeze({})].map(receiver=>{try{set.call(receiver,8);return 'accepted'}catch(error){return error.name}})",
  "const set=Object.getOwnPropertyDescriptor(Iterator.prototype,'constructor').set;const log=[];const object={set constructor(value){log.push(value)}};set.call(object,9);return log",
  "const set=Object.getOwnPropertyDescriptor(Iterator.prototype,'constructor').set;function receiver(){}set.call(receiver,9);return receiver.constructor"
];

it.each(cases)("implements the abstract Iterator constructor: %s", async source => {
  const expected=runInNewContext("(()=>{"+source+"})()");
  const result=await run(source);
  assert(result.ok);
  expect(result.returnValue).toEqual(expected);
});

it("replays an Iterator subclass and its inherited constructor accessor",async()=>{
  const source="class Counter extends Iterator { constructor(){super();this.index=0} next(){return {value:this.index++,done:false}} }const it=new Counter();it.next();await 0;return [it.next(),it instanceof Iterator,it.constructor===Counter,Iterator.prototype.constructor===Iterator]";
  const expected=await runInNewContext("(async()=>{"+source+"})()");
  const first=await run(source);
  assert(first.ok);
  expect(first.returnValue).toEqual(expected);
  const replay=await run(source,{snapshot:JSON.parse(await dump(first))});
  assert(replay.ok);
  expect(replay.returnValue).toEqual(expected);
});

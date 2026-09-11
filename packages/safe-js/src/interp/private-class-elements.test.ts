import { runInNewContext } from "node:vm";
import { assert, expect, it } from "vitest";
import { run } from "../run.js";

it.each([
  "class C{#static\n#x=2;read(){return [#static in this,this.#x]}}return new C().read()",
  "class C{#get\n#x(){return 2}read(){return [#get in this,this.#x()]}}return new C().read()",
  "class C{#set\n#x(value){}read(){return #set in this}}return new C().read()",
  "class C{#async\n#x(){return 2}read(){return [#async in this,this.#x()]}}return new C().read()",
  "class C{#x=this.#m();#m(){return 7}read(){return this.#x}}return new C().read()",
  "class C{static #x=C.#m();static #m(){return 7}static read(){return C.#x}}return C.read()",
  "function make(){return class{#x=1;read(o){return o.#x}}}const A=make(),B=make();const a=new A(),b=new B();let error;try{a.read(b)}catch(e){error=e.name}return [a.read(a),error]",
  "class Base{constructor(o){return o}}class C extends Base{#x=7;static read(o){return o.#x}}const o=Object.freeze({});new C(o);let error;try{new C(o)}catch(e){error=e.name}return [C.read(o),Reflect.ownKeys(o),error]",
  "class C{#x=0;*read(){[this.#x=yield 1]=[undefined];return this.#x}}const g=new C().read();return [g.next(),g.next(7)]",
  "class C{#x=0;*read(){({x:this.#x=yield 1}={});return this.#x}}const g=new C().read();return [g.next(),g.next(8)]",
  "class C{#x=0;read(){[this.#x]=[7];return this.#x}}return new C().read()",
  "class C{#x=0;read(){({x:this.#x}={x:8});return this.#x}}return new C().read()",
  "class C{#x=4;#tag(strings){return this.#x+strings[0]}read(){return this.#tag`ok`}}return new C().read()",
  "class Counter{#value=1;next(){return this.#value++}}const c=new Counter();return [c.next(),c.next(),Reflect.ownKeys(c)]",
  "class Counter{#twice(value){return value*2}read(){return this.#twice(3)}}return new Counter().read()",
  "class Counter{#value=1;get #current(){return this.#value}set #current(value){this.#value=value}read(){this.#current=3;return this.#current}}return new Counter().read()",
  "class Counter{static #value=4;static read(){return this.#value}}return Counter.read()",
  "class Counter{#value;static has(value){return #value in value}}return [Counter.has(new Counter()),Counter.has({})]",
  "class Counter{#value=1;read(){return this.#value}}const valid=new Counter().read();try{return Counter.prototype.read.call({})}catch(error){return [valid,error.name]}",
  "class Base{#value=1;read(){return this.#value}}class Child extends Base{#value=2;readChild(){return this.#value}}const c=new Child();return [c.read(),c.readChild()]"
])("implements private class elements: %s",async source=>{
  const expected=runInNewContext("(()=>{'use strict';"+source+"})()");
  const result=await run(source);
  assert(result.ok, result.ok ? undefined : JSON.stringify(result));
  expect(result.returnValue).toEqual(expected);
});

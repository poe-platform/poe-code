import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";

it.each([
  "return [({}).__proto__===Object.prototype,[].__proto__===Array.prototype,Object.prototype.__proto__]",
  "const p={value:7};const o={};o.__proto__=p;return [o.value,o.__proto__===p,Object.hasOwn(o,'__proto__')]",
  "const o={};o.__proto__=null;return [Object.getPrototypeOf(o),o.__proto__,Object.hasOwn(o,'__proto__')]",
  "const o=Object.create(null);o.__proto__={value:7};return [Object.getPrototypeOf(o),o.value,o.__proto__.value,Object.hasOwn(o,'__proto__')]",
  "const o={};Object.defineProperty(o,'__proto__',{value:7,writable:true});o.__proto__=9;return [o.__proto__,Object.getPrototypeOf(o)===Object.prototype]",
  "const o={};let calls=0;o.__proto__={toString(){calls++;return 'x'}};return [typeof o.toString,calls]",
  "const o={};for(const p of [undefined,7,true,'x',Symbol(),1n])o.__proto__=p;return [Object.getPrototypeOf(o)===Object.prototype,Object.hasOwn(o,'__proto__')]",
  "const get=Object.getOwnPropertyDescriptor(Object.prototype,'__proto__').get;return [get.call(7)===Number.prototype,get.call('x')===String.prototype,get.call(true)===Boolean.prototype,get.call(1n)===BigInt.prototype,get.call(Symbol())===Symbol.prototype]",
  "const set=Object.getOwnPropertyDescriptor(Object.prototype,'__proto__').set;return [set.call(7,{}),set.call('x',null),set.call(true,7)]",
  "const get=Object.getOwnPropertyDescriptor(Object.prototype,'__proto__').get;try{get.call(null)}catch(e){return e.name}",
  "const set=Object.getOwnPropertyDescriptor(Object.prototype,'__proto__').set;try{set.call(null,7)}catch(e){return e.name}",
  "const o={};try{o.__proto__=o}catch(e){return [e.name,Object.getPrototypeOf(o)===Object.prototype]}",
  "const o={},p=Object.create(o);try{o.__proto__=p}catch(e){return e.name}",
  "const o=Object.preventExtensions({});try{o.__proto__={}}catch(e){return e.name}",
  "const o=Object.freeze({});o.__proto__=Object.prototype;return Object.getPrototypeOf(o)===Object.prototype",
  "try{Object.prototype.__proto__={}}catch(e){return [e.name,Object.getPrototypeOf(Object.prototype)]}",
  "Object.prototype.__proto__=null;return Object.getPrototypeOf(Object.prototype)",
  "function parent(){}parent.value=7;function child(){}child.__proto__=parent;return [child.value,child.__proto__===parent]",
  "const d=Object.getOwnPropertyDescriptor(Object.prototype,'__proto__');return [d.get.name,d.get.length,d.set.name,d.set.length,d.enumerable,d.configurable,Object.hasOwn(d,'value')]",
  "const d=Object.getOwnPropertyDescriptor(Object.prototype,'__proto__');let denied=0;try{new d.get()}catch(e){denied++}try{new d.set()}catch(e){denied++}return denied",
  "const o=JSON.parse('{\"__proto__\":{\"value\":7}}');return [Object.hasOwn(o,'__proto__'),Object.getPrototypeOf(o)===Object.prototype,o.value,o.__proto__.value]"
])("matches guest prototype accessor semantics: %s", async source => {
  expect(await run(source)).toMatchObject({ok: true, returnValue: runInNewContext(`(function(){'use strict';${source}})()`)});
});

it("returns only guest function prototypes", async () => {
  expect(await run("return [Array.__proto__===Object.getPrototypeOf(Array),Array.__proto__.constructor===Function,Array.__proto__.kind,Array.__proto__.properties,Array.__proto__.__proto__===Object.prototype,Array.__proto__.constructor('return typeof process')()]"))
    .toMatchObject({ok: true, returnValue: [true,true,undefined,undefined,true,"undefined"]});
});

it("replays an accessor-set prototype and a saved accessor identity", async () => {
  const source = "const set=Object.getOwnPropertyDescriptor(Object.prototype,'__proto__').set;const p={value:7},o={};o.__proto__=p;await 0;return [o.value,o.__proto__===p,set===Object.getOwnPropertyDescriptor(Object.prototype,'__proto__').set]";
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    const saved = JSON.parse(await dump(pending));
    expect(await completed).toMatchObject({ok: true, returnValue: [7,true,true]});
    expect(await run(source, {snapshot: restore(saved, {source})})).toMatchObject({ok: true, returnValue: [7,true,true]});
  } finally { await completed; }
});

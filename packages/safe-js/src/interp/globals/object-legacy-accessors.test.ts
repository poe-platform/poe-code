import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { Budget, run } from "../../core.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";

it.each([
  "const o={};function get(){return this.value}const result=o.__defineGetter__('x',get);o.value=7;const d=Object.getOwnPropertyDescriptor(o,'x');return [result,o.x,d.get===get,d.set,d.enumerable,d.configurable]",
  "const o={};function set(x){this.value=x}const result=o.__defineSetter__('x',set);o.x=7;const d=Object.getOwnPropertyDescriptor(o,'x');return [result,o.value,d.get,d.set===set,d.enumerable,d.configurable]",
  "const o={};function get(){return 7}function set(x){}o.__defineGetter__('x',get);o.__defineSetter__('x',set);return [o.__lookupGetter__('x')===get,o.__lookupSetter__('x')===set]",
  "const o={x:7};o.__defineGetter__('x',()=>9);return [o.x,Object.hasOwn(Object.getOwnPropertyDescriptor(o,'x'),'value')]",
  "let reads=0;function get(){reads++;return 7}const p={};p.__defineGetter__('x',get);const o=Object.create(p);return [o.__lookupGetter__('x')===get,o.__lookupSetter__('x'),reads]",
  "let reads=0;const p={get x(){reads++;throw 7}};const o=Object.create(p);const get=o.__lookupGetter__('x');let thrown;try{get.call(o)}catch(e){thrown=e}return [thrown,reads]",
  "const p={get x(){return 7}};const o=Object.create(p);Object.defineProperty(o,'x',{value:9});return o.__lookupGetter__('x')",
  "const p={get x(){return 7}};const o=Object.create(p);Object.defineProperty(o,'x',{set(x){}});return o.__lookupGetter__('x')",
  "const o=Object.create(null);function get(){return 7}Object.prototype.__defineGetter__.call(o,'x',get);return [o.x,Object.prototype.__lookupGetter__.call(o,'x')===get,Object.prototype.__lookupGetter__.call(o,'absent')]",
  "const k=Symbol();const o={};function get(){return 7}o.__defineGetter__(k,get);return [o[k],o.__lookupGetter__(k)===get]",
  "const seen=[];const key={[Symbol.toPrimitive](hint){seen.push(hint);return 'x'}};const o={};o.__defineGetter__(key,()=>7);return [o.__lookupGetter__(key)===Object.getOwnPropertyDescriptor(o,'x').get,seen]",
  "const seen=[];try{Object.prototype.__defineGetter__.call(null,{toString(){seen.push('key');return 'x'}},null)}catch(e){return [e.name,seen]}",
  "const seen=[];try{({}).__defineGetter__({toString(){seen.push('key');return 'x'}},undefined)}catch(e){return [e.name,seen]}",
  "const seen=[];try{Object.prototype.__lookupGetter__.call(undefined,{toString(){seen.push('key');return 'x'}})}catch(e){return [e.name,seen]}",
  "try{Object.freeze({}).__defineGetter__('x',()=>7)}catch(e){return e.name}",
  "try{const o={};Object.defineProperty(o,'x',{get(){return 7},configurable:false});o.__defineGetter__('x',()=>9)}catch(e){return e.name}",
  "return Object.prototype.__defineGetter__.call(7,'x',()=>8)",
  "try{return Object.prototype.__defineGetter__.call('abc','0',()=>8)}catch(e){return e.name}",
  "function f(){}f.__defineGetter__('x',()=>7);return [f.x,typeof f.__lookupGetter__('x'),f.kind,f.properties]",
  "const a=[];a.__defineGetter__('2',()=>7);return [a.length,a[2],Object.keys(a)]",
  "try{new Uint8Array(2).__defineGetter__('0',()=>7)}catch(e){return e.name}",
  "const o=new Map();o.__defineGetter__('x',()=>7);return [o.x,typeof o.__lookupGetter__('x'),o.size]",
  "const o=/a/;o.__defineGetter__('x',()=>7);return [o.x,typeof o.__lookupGetter__('x'),o.source]"
])("matches legacy accessor semantics: %s", async source => {
  expect(await run(source)).toMatchObject({ok: true, returnValue: runInNewContext(`(function(){'use strict';${source}})()`)});
});

it("walks past an absent integer-indexed own descriptor as specified", async () => {
  // ECMA-262 20.1.3.9.3 explicitly walks GetOwnProperty/GetPrototypeOf.
  // V8's legacy lookup stops at an absent typed-array index instead.
  const setup = "const a=new Uint8Array(0);const p=Object.create(Uint8Array.prototype);function get(){return 7}Object.defineProperty(p,'0',{get});Object.setPrototypeOf(a,p);";
  const oracle = `${setup}let o=a;while(o!==null){const d=Object.getOwnPropertyDescriptor(o,'0');if(d!==undefined)return d.get===get;o=Object.getPrototypeOf(o)}return false`;
  expect(runInNewContext(`(function(){${oracle}})()`)).toBe(true);
  expect(await run(`${setup}return a.__lookupGetter__('0')===get`)).toMatchObject({ok: true, returnValue: true});
});

it.each(["__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__"])("preserves %s metadata", async name => {
  const source = `const f=Object.prototype[${JSON.stringify(name)}];const d=Object.getOwnPropertyDescriptor(Object.prototype,${JSON.stringify(name)});let denied=false;try{new f()}catch(e){denied=e instanceof TypeError}return [f.name,f.length,d.writable,d.enumerable,d.configurable,denied]`;
  expect(await run(source)).toMatchObject({ok: true, returnValue: runInNewContext(`(function(){${source}})()`)});
});

it("preserves a getter closure through a checkpoint", async () => {
  const source = "const key=Symbol('key');const o={value:7};o.__defineGetter__(key,function(){return this.value});o.__defineSetter__(key,function(x){this.value=x});await 0;o[key]=9;return [o[key],o.__lookupGetter__(key)===Object.getOwnPropertyDescriptor(o,key).get]";
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    const saved = JSON.parse(await dump(pending));
    expect(await completed).toMatchObject({ok: true, returnValue: [9,true]});
    expect(await run(source, {snapshot: restore(saved, {source})})).toMatchObject({ok: true, returnValue: [9,true]});
  } finally { await completed; }
});

it("keeps step exhaustion in key coercion fatal", async () => {
  await expect(run("try{({}).__defineGetter__({toString(){while(true){}return 'x'}},()=>7)}catch(e){return 'caught'}", {budget: new Budget({maxSteps: 100})}))
    .rejects.toMatchObject({code: "budgetExceeded", budget: "steps"});
});

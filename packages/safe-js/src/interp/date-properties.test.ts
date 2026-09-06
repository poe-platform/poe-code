import { describe, expect, it } from "vitest";
import { run } from "../core.js";
import { createSandboxDate } from "./date.js";
import { cloneSandboxValue, deepCopyFromSandbox, deepCopyToSandbox, measureSandboxData } from "./values.js";

describe("Date own properties", () => {
  it.each(["preventExtensions", "seal", "freeze"] as const)("preserves %s on imported and internally cloned Dates", integrity => {
    const source = new Date(7);
    const key = Symbol("self");
    Object.defineProperty(source, key, { value: source, writable: true, enumerable: true, configurable: true });
    Object[integrity](source);
    const imported = deepCopyToSandbox(source);
    for (const value of [imported, cloneSandboxValue(imported), deepCopyFromSandbox(imported)]) {
      expect(Object.isExtensible(value)).toBe(false);
      expect(Object.isSealed(value)).toBe(Object.isSealed(source));
      expect(Object.isFrozen(value)).toBe(Object.isFrozen(source));
      expect(Object.getOwnPropertyDescriptor(value, key)).toEqual({ ...Object.getOwnPropertyDescriptor(source, key), value });
      expect(Date.prototype.getTime.call(value)).toBe(7);
    }
    expect(Object.isExtensible(cloneSandboxValue(imported, { structuredClone: true }))).toBe(true);
  });
  it.each(["preventExtensions", "seal", "freeze"] as const)("preserves %s on exported Dates", async integrity => {
    const result = await run(`const date=new Date(7);date.label={text:'epoch'};Object.${integrity}(date);return date;`);
    if (!result.ok) throw new Error("Expected guest Date");
    const exported = deepCopyFromSandbox(result.returnValue);
    const expected = new Date(7);
    Object.defineProperty(expected, "label", { value: { text: "epoch" }, writable: true, enumerable: true, configurable: true });
    Object[integrity](expected);
    expect(Object.isExtensible(exported)).toBe(Object.isExtensible(expected));
    expect(Object.isSealed(exported)).toBe(Object.isSealed(expected));
    expect(Object.isFrozen(exported)).toBe(Object.isFrozen(expected));
    expect(Object.getOwnPropertyDescriptor(exported, "label")).toEqual(Object.getOwnPropertyDescriptor(expected, "label"));
    expect(Reflect.defineProperty(exported as object, "extra", { value: 1 })).toBe(false);
    // Freezing a Date does not freeze its internal time slot.
    expect(Date.prototype.setTime.call(exported, 9)).toBe(9);
  });
  it("rejects Date accessors at the copy boundary without invoking getters", () => {
    let reads = 0;
    const date = new Date(0);
    Object.defineProperty(date, "label", { get() { reads++; return 7; } });
    expect(() => deepCopyToSandbox(date)).toThrow("accessor properties");
    expect(reads).toBe(0);
  });
  it("copies own data descriptors and symbol-keyed cycles across the boundary", () => {
    const key = Symbol("self");
    const source = new Date(7);
    Object.defineProperty(source, "label", { value: { text: "epoch" } });
    Object.defineProperty(source, key, { value: source, enumerable: true });
    const copied = deepCopyToSandbox(source);
    const exported = deepCopyFromSandbox(copied);
    for (const value of [copied, exported]) {
      expect(value).not.toBe(source);
      expect(Date.prototype.getTime.call(value)).toBe(7);
      expect(Object.getOwnPropertyDescriptor(value, "label")).toEqual({ value: { text: "epoch" }, writable: false, enumerable: false, configurable: false });
      expect(Object.getOwnPropertyDescriptor(value, "label")?.value).not.toBe(Object.getOwnPropertyDescriptor(source, "label")?.value);
      expect(Object.getOwnPropertyDescriptor(value, key)?.value).toBe(value);
    }
  });
  it("counts retained non-enumerable string properties in the data budget", () => {
    const date = createSandboxDate(0);
    const baseline = measureSandboxData([date]);
    Object.defineProperty(date, "label", { value: "x".repeat(1024) });
    expect(measureSandboxData([date]) - baseline).toBe(1030);
  });
  it.each([
    "const date=new Date(0);date.label='epoch';return [date.label,date.getTime(),Object.keys(date)];",
    "const date=new Date(0);const key=Symbol('key');date[key]=7;return [date[key],Object.getOwnPropertySymbols(date)[0]===key];",
    "const date=new Date(0);Object.defineProperty(date,'label',{value:7});return [date.label,Object.getOwnPropertyDescriptor(date,'label')];",
    "const date=new Date(0);Object.defineProperty(date,'label',{get(){return this.getTime()+7}});return date.label;",
    "const date=new Date(0);date.valueOf=()=>7;return +date;",
    "const date=new Date(0);date.toJSON=function(key){return this.label+key};date.label='custom:';return JSON.stringify({date});",
    "const date=new Date(0);date.toJSON=undefined;date.label=7;return JSON.stringify(date);",
    "const date=new Date(0);let reads=0;Object.defineProperty(date,'toJSON',{get(){reads++;return function(key){return key+':custom'}}});const json=JSON.stringify({date});return [json,reads];",
    "const date=new Date(0);const log=[];date.toJSON=function(key){log.push('json:'+key);return 7};const json=JSON.stringify({date},function(key,value){log.push('replace:'+key);return value});return [json,log];",
    "const date=new Date(0);date.toJSON=null;date.label=7;return JSON.stringify(date);",
    "const date=new Date(0);date.valueOf=()=>NaN;return [date.toJSON(),JSON.stringify(date)];",
    "const date=new Date(0);date.toISOString=()=> 'custom';return [date.toJSON(),JSON.stringify(date)];",
    "return Date.prototype.toJSON.call({valueOf(){return 7},toISOString(){return 'generic'}});",
    "return Date.prototype.toJSON.call({valueOf(){return Infinity},get toISOString(){throw new Error('must not read')}});",
    "return [Date.prototype.toJSON.call(NaN),Date.prototype.toJSON.call(Infinity)];",
    "const log=[];const object={[Symbol.toPrimitive](hint){log.push(hint);return 7},get toISOString(){log.push('get');return function(){log.push(this===object);return 'custom'}}};const result=Date.prototype.toJSON.call(object);return [result,log];",
    "try{return Date.prototype.toJSON.call({valueOf(){return 7},toISOString:7})}catch(error){return error.name}",
    "Number.prototype.toISOString=function(){return [typeof this,this.valueOf()]};try{return Date.prototype.toJSON.call(7)}finally{delete Number.prototype.toISOString}",
    "String.prototype.toISOString=function(){return [typeof this,this.valueOf()]};try{return Date.prototype.toJSON.call('text')}finally{delete String.prototype.toISOString}",
    "Boolean.prototype.toISOString=function(){return [typeof this,this.valueOf()]};try{return Date.prototype.toJSON.call(true)}finally{delete Boolean.prototype.toISOString}",
    "const date=new Date(0);date.getTime=function(){return this.label};date.label=7;return date.getTime();",
    "const date=new Date(0);let reads=0;Object.defineProperty(date,'getTime',{get(){reads++;return function(){return this.label}}});date.label=7;return [date.getTime(),reads];",
    "const date=new Date(0);date.getTime=7;try{return date.getTime()}catch(error){return error.name}",
    "const date=new Date(0);date.label=7;return [delete date.label,date.label];"
  ])("matches native: %s", async source => {
    expect(await run(source)).toMatchObject({ ok: true, returnValue: new Function(source)() });
  });
});

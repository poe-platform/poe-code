import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

describe.each(["DataView", "SharedArrayBuffer"])("%s prototype binding", name => {
  const argument = name === "DataView" ? "new ArrayBuffer(0)" : "0";
  it.each([
    `const d=Object.getOwnPropertyDescriptor(${name},'prototype');return [d.writable,d.enumerable,d.configurable]`,
    `const original=${name}.prototype;return [Reflect.set(${name},'prototype',{}),${name}.prototype===original]`,
    `try{${name}.prototype={};return false}catch(error){return error instanceof TypeError}`,
    `return Reflect.defineProperty(${name},'prototype',{value:{}})`,
    `try{Object.defineProperty(${name},'prototype',{writable:true});return false}catch(error){return error instanceof TypeError}`,
    `const proxy=new Proxy(${name},{set(){return true}});try{Reflect.set(proxy,'prototype',{});return false}catch(error){return error instanceof TypeError}`,
    `class Derived extends ${name}{}const value=new Derived(${argument});return [value instanceof Derived,value instanceof ${name},Object.getPrototypeOf(value)===Derived.prototype]`,
    `${name}.prototype.extra=7;return new ${name}(${argument}).extra`
  ])("matches native behavior before and after replay: %s", async body => {
    const source = `"use strict";await 0;${body}`;
    const expected = await runInNewContext(`(async()=>{${source}})()`, {}, { timeout: 1000 });
    const original = await run(source);
    expect(original).toMatchObject({ ok: true, returnValue: expected });
    const replayed = await run(source, { snapshot: JSON.parse(await dump(original)) });
    expect(replayed).toMatchObject({ ok: true, returnValue: expected });
  });
});

import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { Budget, createRealm, run } from "../core.js";
import { createObjectArrayGlobals } from "./globals/object-array.js";
import { hasGuestObjectState, releaseObjectPrototype, setSandboxPrototype } from "./object-model.js";
import { measureSandboxData } from "./values.js";

describe("callable prototype links", () => {
  it.each([
    'function parent(){}parent.value=7;function child(){}Object.setPrototypeOf(child,parent);return [child.value,Object.getPrototypeOf(child)===parent]',
    'function parent(){}parent.value=7;function child(){}Object.setPrototypeOf(child,parent);parent.value=8;return child.value',
    'function parent(){}parent.read=function(){return this.value};function child(){}child.value=9;Object.setPrototypeOf(child,parent);return child.read()',
    'function parent(){}parent.value=7;const child=()=>9;Object.setPrototypeOf(child,parent);return [child(),child.value]',
    'function parent(){}parent.value=7;async function child(){return 9}Object.setPrototypeOf(child,parent);return child.value',
    'function parent(){}parent.value=7;function* child(){yield 9}Object.setPrototypeOf(child,parent);return [child.value,child().next().value]',
    'function parent(){}parent.value=7;const child=Object.create(parent);return [child.value,Object.getPrototypeOf(child)===parent]',
    'function parent(){}parent.value=7;const child={__proto__:parent};return [child.value,Object.getPrototypeOf(child)===parent]',
    'function parent(){}parent.value=7;const child=new Number(8);Object.setPrototypeOf(child,parent);return [child.value,Object.getPrototypeOf(child)===parent]',
    'function child(){return 7}Object.setPrototypeOf(child,{value:9});return [child(),child.value,typeof child.call,child.toString()]',
    'function child(){return 7}Object.setPrototypeOf(child,null);return [child(),typeof child.call,typeof child.toString,child.name,child.length]',
    'function parent(){}parent.call=()=>7;function child(){}Object.setPrototypeOf(child,parent);return child.call()',
    'function parent(){}parent.call=undefined;function child(){}Object.setPrototypeOf(child,parent);return [child.call,"call" in child]',
    'function parent(){}parent.value=undefined;function child(){}Object.setPrototypeOf(child,parent);return [child.value,"value" in child]',
    'function parent(){}parent.value=7;function child(){}child.value=undefined;Object.setPrototypeOf(child,parent);return [child.value,"value" in child]',
    'function parent(){}parent.value=7;function child(){}child.value=8;Object.setPrototypeOf(child,parent);delete child.value;return child.value',
    'function parent(){}parent.value=7;function child(){}Object.setPrototypeOf(child,parent);return [Object.keys(child),Object.hasOwn(child,"value")]',
    'function parent(){}parent.value=7;function child(){}child.own=8;Object.setPrototypeOf(child,parent);const keys=[];for(const key in child)keys.push(key);return keys',
    'function parent(){}parent.value=7;function child(){}Object.defineProperty(child,"value",{value:8});Object.setPrototypeOf(child,parent);const keys=[];for(const key in child)keys.push(key);return keys',
    'function parent(){}Object.defineProperty(parent,"value",{value:7});function child(){}Object.setPrototypeOf(child,parent);try{child.value=8}catch(error){return [error.name,child.value]}',
    'function parent(){}parent.value=7;function child(){}Object.setPrototypeOf(child,parent);child.value=8;return [child.value,parent.value,Object.hasOwn(child,"value")]',
    'function parent(){}function child(){}Object.setPrototypeOf(child,parent);Object.freeze(child);return Object.setPrototypeOf(child,parent)===child',
    'function parent(){}function child(){}Object.freeze(child);try{Object.setPrototypeOf(child,parent)}catch(error){return error.name}',
    'function parent(){}function child(){}Object.setPrototypeOf(child,parent);try{Object.setPrototypeOf(parent,child)}catch(error){return error.name}',
    'function child(){}try{Object.setPrototypeOf(child,child)}catch(error){return error.name}',
    'function parent(){}parent.value=7;function child(){}Object.setPrototypeOf(child,parent);const bound=child.bind(null);return [Object.getPrototypeOf(bound)===parent,bound.value]',
    'function child(){return 7}const bind=child.bind;Object.setPrototypeOf(child,null);const bound=bind.call(child,null);return [Object.getPrototypeOf(bound)===null,bound(),typeof bound.call]',
    'function parent(){}parent.value=7;function child(){}Object.setPrototypeOf(child,parent);const bound=child.bind(null);Object.setPrototypeOf(child,{});return [Object.getPrototypeOf(bound)===parent,bound.value]',
    'function parent(){}parent.valueOf=()=>7;function child(){}Object.setPrototypeOf(child,parent);return [Number(child),isFinite(child)]',
    'function parent(){}parent.toString=()=>"7";function child(){}Object.setPrototypeOf(child,parent);return [String(child),JSON.parse(child)]',
    'function parent(){}parent.value=7;function C(){}C.prototype=parent;const value=new C();return [value.value,value instanceof C,Object.getPrototypeOf(value)===parent]',
    'function parent(){}function child(){}Object.setPrototypeOf(child,parent);return Object.prototype.isPrototypeOf.call(parent,child)',
    'function parent(){}parent.value=7;Object.setPrototypeOf(Number,parent);return [Number.value,Number("8"),Number.isFinite(9)]',
    'function parent(){}parent.value=7;Object.setPrototypeOf(String,parent);return [String.value,String(8)]',
    'function parent(){}parent.value=7;Object.setPrototypeOf(Boolean,parent);return [Boolean.value,Boolean(8)]',
    'function child(){return 7}return [child(),child.name,child.length,typeof child.call]',
    'const parent={value:7};const child=Object.create(parent);return child.value'
  ])("matches native behavior: %s", async (source) => {
    const expected = runInNewContext(`(()=>{'use strict';${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it("keeps inherited callable state in persistent realms and releases it", async () => {
    const budget = new Budget();
    const realm = createRealm({ budget });
    try {
      await realm.evaluate('function parent(){}parent.value=7;function child(){}Object.setPrototypeOf(child,parent);');
      expect(await realm.evaluate("return child.value")).toMatchObject({ ok: true, returnValue: 7 });
      await realm.evaluate("parent.value=8");
      expect(await realm.evaluate("return child.value")).toMatchObject({ ok: true, returnValue: 8 });
    } finally {
      await realm.close();
    }
    expect([...budget.retainedValues()]).toEqual([]);
  });

  it.each(["Object", "Number", "String", "Boolean"] as const)("retains %s intrinsic prototype mutations", (name) => {
    const budget = new Budget();
    const globals = createObjectArrayGlobals({ budget });
    try {
      expect(hasGuestObjectState(globals[name])).toBe(false);
      setSandboxPrototype(globals[name], { payload: "x".repeat(700) }, budget);
      expect(measureSandboxData([...budget.retainedValues()])).toBeGreaterThanOrEqual(700);
      expect(hasGuestObjectState(globals[name])).toBe(true);
    } finally {
      releaseObjectPrototype(budget);
    }
    expect([...budget.retainedValues()]).toEqual([]);
  });

  it.each(["Object", "Number", "String", "Boolean"] as const)("does not mark unchanged %s as mutated after realm cleanup", (name) => {
    const budget = new Budget();
    const globals = createObjectArrayGlobals({ budget });
    releaseObjectPrototype(budget);
    expect(hasGuestObjectState(globals[name])).toBe(false);
  });

  it("keeps inherited state when a host invokes a guest callback", async () => {
    const result = await run("function Parent(){}Parent.value=7;function child(){return child.value}Object.setPrototypeOf(child,Parent);return await invoke(child)", {
      bindings: { invoke: async (callback: () => Promise<unknown>) => callback() }
    });
    expect(result).toMatchObject({ ok: true, returnValue: 7 });
  });

  it("does not expose private callable implementation fields", async () => {
    const result = await run('function parent(){}function child(){}Object.setPrototypeOf(child,parent);return [child.kind,child.sourceRange,child.sandbox,child.construct,child.retainedValues]');
    expect(result).toMatchObject({ ok: true, returnValue: [undefined, undefined, undefined, undefined, undefined] });
  });
});

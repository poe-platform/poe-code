import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { run } from "../core.js";
import { Budget } from "./budget.js";
import { setSandboxPrototype } from "./object-model.js";
import { deepCopyFromSandbox } from "./values.js";
import { serializeSafeJSSnapshot } from "../snapshot/dump-format.js";

describe("explicit array prototype links", () => {
  it.each([
    "const value=[];Object.setPrototypeOf(value,{extra:undefined});return 'extra' in value;",
    "let reads=0;const value=[];Object.setPrototypeOf(value,{get extra(){reads++;return 7}});const present='extra' in value;return [present,reads];",
    "const value=[7];Object.setPrototypeOf(value,null);try{return String(value)}catch(error){return error.name}",
    "const value=[,];Object.setPrototypeOf(value,{0:7,extra:8});return [0 in value,'extra' in value];",
    "const value=[,];Object.setPrototypeOf(value,{0:7,extra:8});const keys=[];for(const key in value)keys.push(key);return keys;",
    "function Counter(){}Counter.prototype=[7];const value=new Counter();return [value[0],Object.getPrototypeOf(value)===Counter.prototype,Array.isArray(value)];",
    "const value=[7];Object.setPrototypeOf(value,{[Symbol.iterator]:function*(){yield this[0]+1}});return [...value];",
    "const value=[7];Object.setPrototypeOf(value,{map(){return this[0]+1}});return value.map();",
    "const value=[];Object.setPrototypeOf(value,null);return [typeof value.map,typeof value.push];",
    "const value=[7];Object.setPrototypeOf(value,null);try{return [...value]}catch(error){return error.name}",
    "const value=[];Object.setPrototypeOf(value,null);try{value.push(7)}catch(error){return error.name}",
    "const value=[,];const prototype={0:7};Object.setPrototypeOf(value,prototype);return [value[0],Object.getPrototypeOf(value)===prototype];",
    "const value=[,];Object.setPrototypeOf(value,{get 0(){return this===value?7:0}});return value[0];",
    "const prototype=[7];const value=Object.create(prototype);return [value[0],Object.getPrototypeOf(value)===prototype];",
    "const value=[];Object.setPrototypeOf(value,null);return Object.getPrototypeOf(value)===null;",
    "const value=[];const prototype={};Object.setPrototypeOf(value,prototype);Object.freeze(value);return Object.setPrototypeOf(value,prototype)===value;",
    "const value=[];Object.freeze(value);try{Object.setPrototypeOf(value,{})}catch(error){return error.name}",
    "const value=[];const prototype={};Object.setPrototypeOf(value,prototype);try{Object.setPrototypeOf(prototype,value)}catch(error){return error.name}"
  ])("matches native: %s", async (source) => {
    const expected = runInNewContext("(function(){'use strict';" + source + "})()");
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });
  it("does not silently discard a custom array prototype during data copying", () => {
    const value: number[] = [];
    setSandboxPrototype(value, { inherited: 7 }, new Budget());
    expect(() => deepCopyFromSandbox(value)).toThrow(/prototype/i);
    const snapshot = JSON.parse(serializeSafeJSSnapshot({ sourceHash: "array-prototype", bindings: { value } }));
    expect(snapshot.heap[snapshot.bindings.value.id]).toMatchObject({
      kind: "guest-array", state: { prototype: { kind: "ref" } }
    });
  });
});
